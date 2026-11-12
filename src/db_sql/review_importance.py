"""带题目版本校验的 AI 重要性建议；进程缓存，不修改错题或复习记录。"""
from collections import OrderedDict
import hashlib
import json
import os
from threading import Lock
import time
from typing import Literal

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from src.db_sql.review_insight import TeachingImportance

_cache = OrderedDict()
_lock = Lock()


def source_fingerprint(item):
    fields = ('question', 'correct_answer', 'material', 'tags', 'content_truncated', 'has_visual_content')
    encoded = json.dumps({key: item[key] for key in fields}, ensure_ascii=False,
                         sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(encoded.encode('utf-8')).hexdigest()


def cached_importance(user_id, item):
    key = (user_id, item['id'])
    with _lock:
        saved = _cache.get(key)
        if saved and saved[0] > time.monotonic() and saved[1] == source_fingerprint(item):
            _cache.move_to_end(key)
            return saved[2].model_copy(deep=True)
        _cache.pop(key, None)
    return None


def remember_importance(user_id, item, importance):
    ttl = 60 if importance.code == 'unknown' else 3600
    with _lock:
        _cache[(user_id, item['id'])] = (time.monotonic() + ttl, source_fingerprint(item), importance.model_copy(deep=True))
        _cache.move_to_end((user_id, item['id']))
        while len(_cache) > 512:
            _cache.popitem(last=False)


class Assessment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    importance: Literal['unknown', 'ordinary', 'foundational', 'integrative']
    evidence: list[str] = Field(max_length=2)
    reason: str = Field(max_length=200)


class AssessmentResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    entry_id: str
    assessment: Assessment
    weight: float = Field(ge=1, le=1.5, allow_inf_nan=False)
    status: Literal['complete', 'partial', 'unavailable']
    as_of: str
    source_fingerprint: str = Field(pattern=r'^[a-f0-9]{64}$')
    assessment_version: Literal['teaching-importance-v1']


async def assess_importance(item, authorization):
    base = os.getenv('RAG_AGENT_URL', 'http://127.0.0.1:8001').rstrip('/')
    try:
        async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
            response = await client.post(f'{base}/review/importance', json={'entry_id': item['id']},
                                         headers={'Authorization': authorization})
        if response.status_code in (401, 403, 404):
            raise HTTPException(response.status_code, '登录无效或题目不可用')
        response.raise_for_status()
        result = AssessmentResponse.model_validate(response.json())
        if result.entry_id != item['id'] or result.source_fingerprint != source_fingerprint(item):
            raise ValueError('评估题目或版本不一致')
        assessment = result.assessment
        weights = {'unknown': 1.0, 'ordinary': 1.0, 'foundational': 1.25, 'integrative': 1.5}
        if result.weight != weights[assessment.importance]:
            raise ValueError('重要性权重不一致')
        if assessment.importance != 'unknown':
            texts = [item[key] for key in ('question', 'correct_answer', 'material')]
            grounded = bool(assessment.evidence) and all(quote.strip() and len(quote) <= 120 and
                any(quote in text for text in texts) for quote in assessment.evidence)
            if (result.status != 'complete' or not item['question'].strip() or item['content_truncated'] or
                    item['has_visual_content'] or not grounded):
                raise ValueError('重要性缺少可靠原文依据')
        elif assessment.evidence:
            raise ValueError('未知重要性不应附带未经确认的引文')
    except httpx.TimeoutException as exc:
        raise HTTPException(504, '重要性评估超时，请稍后重试') from exc
    except httpx.ConnectError as exc:
        raise HTTPException(503, '重要性评估服务未启动') from exc
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise HTTPException(502, '重要性评估结果未通过校验，请稍后重试') from exc
    labels = {'unknown': '证据不足', 'ordinary': '普通单项练习（AI 建议）',
              'foundational': '基础关键方法（AI 建议）', 'integrative': '综合应用（AI 建议）'}
    return TeachingImportance(code=assessment.importance, label=labels[assessment.importance],
        weight=None if assessment.importance == 'unknown' else result.weight,
        basis=assessment.reason, evidence=assessment.evidence,
        source='ai_suggestion' if result.status == 'complete' else 'none',
        assessed_at=result.as_of, assessment_version=result.assessment_version)
