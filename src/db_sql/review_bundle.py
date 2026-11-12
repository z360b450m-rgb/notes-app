"""关联复习草案的边界校验和签名；确认时重读账号归属与正文版本。"""
import base64
import hashlib
import hmac
import json
import time
from typing import Literal

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from src.db_sql import auth
from src.db_sql.review_importance import source_fingerprint


class Relation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    relation: Literal['anchor', 'recalled', 'same_concept', 'prerequisite', 'transfer']
    reason: str = Field(min_length=1, max_length=200)
    anchor_evidence: list[str] = Field(max_length=2)
    candidate_evidence: list[str] = Field(max_length=2)


class Importance(BaseModel):
    model_config = ConfigDict(extra='forbid')
    importance: Literal['unknown', 'ordinary', 'foundational', 'integrative']
    reason: str = Field(max_length=200)
    evidence: list[str] = Field(max_length=2)


class BundleItem(BaseModel):
    model_config = ConfigDict(extra='forbid')
    entry_id: str
    notebook_id: str
    title: str
    question_preview: str = Field(max_length=120)
    subject: str | None
    knowledge_points: list[str]
    estimated_seconds: StrictInt = Field(ge=60, le=1800)
    source_fingerprint: str = Field(pattern=r'^[a-f0-9]{64}$')
    relation: Relation
    importance: Importance


class RetrievalInfo(BaseModel):
    model_config = ConfigDict(extra='forbid')
    strategy: Literal['semantic-v2']
    status: Literal['complete', 'partial', 'unavailable', 'no_index']
    candidate_count: StrictInt = Field(ge=0, le=49)
    hydrated_count: StrictInt = Field(ge=0, le=49)
    channels: list[Literal['stem', 'structure', 'graph']] = Field(max_length=3)
    graph_available: bool
    warnings: list[str] = Field(max_length=10)


class BundleResult(BaseModel):
    model_config = ConfigDict(extra='forbid')
    anchor_entry_id: str
    notebook_id: str
    items: list[BundleItem] = Field(min_length=1, max_length=10)
    relation_status: Literal['complete', 'partial', 'no_candidates', 'unavailable']
    relation_warnings: list[str] = Field(default_factory=list, max_length=10)
    importance_status: Literal['complete', 'partial', 'unavailable']
    related_count: StrictInt = Field(ge=0, le=50)
    ranking_pool_count: StrictInt = Field(ge=0, le=50)
    candidate_truncated: bool
    as_of: str
    bundle_version: Literal['related-review-v1']
    retrieval: RetrievalInfo | None = None


def grounded(quotes, row):
    return bool(quotes) and all(quote.strip() and len(quote) <= 120 and
        any(quote in row[key] for key in ('question', 'correct_answer', 'material')) for quote in quotes)


def validate_bundle(result, anchor, sources, limit):
    ids = [row.entry_id for row in result.items]
    if (result.anchor_entry_id != anchor['id'] or result.notebook_id != anchor['notebook_id'] or
        len(ids) > limit or len(ids) != len(set(ids)) or ids[0] != anchor['id'] or set(ids) != set(sources)):
        raise ValueError('复习组范围不一致')
    for item in result.items:
        row = sources[item.entry_id]
        if item.notebook_id != anchor['notebook_id'] or row['notebook_id'] != anchor['notebook_id']:
            raise ValueError('复习组超出当前错题本')
        if item.source_fingerprint != source_fingerprint(row):
            raise HTTPException(409, '题目已修改，请重新组题')
        if item.title != row['title'] or item.question_preview != row['question'][:120] or item.knowledge_points != row['tags']:
            raise ValueError('复习组摘要与原题不一致')
        relation = item.relation
        if item.entry_id == anchor['id']:
            if relation.relation != 'anchor':
                raise ValueError('锚点关系无效')
        elif relation.relation == 'recalled':
            if relation.anchor_evidence or relation.candidate_evidence:
                raise ValueError('召回补充题不能携带未经核验的关联引文')
        elif (relation.relation == 'anchor' or row['content_truncated'] or row['has_visual_content'] or
            anchor['content_truncated'] or anchor['has_visual_content'] or
            not grounded(relation.anchor_evidence, anchor) or not grounded(relation.candidate_evidence, row)):
            raise ValueError('关联判断缺少双题依据')
        if item.importance.importance != 'unknown' and (row['content_truncated'] or row['has_visual_content'] or
                not grounded(item.importance.evidence, row)):
            raise ValueError('重要性依据不成立')


def _key():
    # 用途隔离：草案签名不能作为登录 JWT 使用，且多工作进程可一致验证。
    return hmac.new(auth.SECRET_KEY.encode('utf-8'), b'related-review-draft-v1', hashlib.sha256).digest()


def sign_draft(user_id, anchor_id, notebook_id, rows):
    expires = int(time.time())+900
    payload = {'purpose': 'related-review-v1', 'owner': user_id, 'anchor': anchor_id, 'notebook': notebook_id,
               'expires': expires, 'items': [{'id': row['id'], 'hash': source_fingerprint(row)} for row in rows]}
    encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(',', ':'), sort_keys=True).encode()).rstrip(b'=').decode()
    signature = hmac.new(_key(), encoded.encode(), hashlib.sha256).hexdigest()
    return encoded+'.'+signature, expires*1000


def verify_draft(token, user_id, anchor_id):
    try:
        encoded, signature = token.split('.')
        expected = hmac.new(_key(), encoded.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError('签名无效')
        payload = json.loads(base64.urlsafe_b64decode(encoded+'='*(-len(encoded)%4)))
        items = payload['items']
        ids = [item['id'] for item in items]
        if (payload['purpose'] != 'related-review-v1' or payload['owner'] != user_id or payload['anchor'] != anchor_id or
            not 1 <= len(ids) <= 10 or ids[0] != anchor_id or len(ids) != len(set(ids))):
            raise ValueError('范围不一致')
        if payload['expires'] <= time.time():
            raise HTTPException(409, '复习建议已过期，请重新组题')
        return payload
    except HTTPException:
        raise
    except (ValueError, TypeError, KeyError, UnicodeError) as exc:
        raise HTTPException(422, '复习建议无效，请重新组题') from exc


async def request_bundle(entry_id, limit, authorization):
    import os
    try:
        base = os.getenv('RAG_AGENT_URL', 'http://127.0.0.1:8001').rstrip('/')
        async with httpx.AsyncClient(timeout=125, trust_env=False) as client:
            response = await client.post(base+'/review/bundle', json={'entry_id': entry_id, 'limit': limit},
                                         headers={'Authorization': authorization})
        if response.status_code in (401, 403, 404):
            raise HTTPException(response.status_code, '登录无效或题目不可用')
        response.raise_for_status()
        return BundleResult.model_validate(response.json())
    except httpx.TimeoutException as exc:
        raise HTTPException(504, '关联组题超时，请重试') from exc
    except httpx.ConnectError as exc:
        raise HTTPException(503, '关联组题服务未启动') from exc
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise HTTPException(502, '复习组结果未通过校验，请重试') from exc
