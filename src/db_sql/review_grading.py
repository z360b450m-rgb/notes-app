"""业务端核对结构化判卷结果，模型不会直接写复习日志。"""
import os
from typing import Literal

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator

from src.db_sql.review_importance import source_fingerprint


class Criterion(BaseModel):
    model_config = ConfigDict(extra='forbid')
    verdict: Literal['correct', 'incorrect', 'uncertain', 'missing', 'valid', 'invalid']
    student_evidence: list[str] = Field(max_length=3)
    reference_evidence: list[str] = Field(max_length=3)
    feedback: str = Field(min_length=1, max_length=600)


class Assessment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    answer: Criterion
    explanation: Criterion


class GradeResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    entry_id: str
    source_fingerprint: str = Field(pattern=r'^[a-f0-9]{64}$')
    status: Literal['awaiting_explanation', 'needs_review', 'final']
    is_correct: StrictBool | None
    assessment: Assessment
    comment: str = Field(max_length=2000)
    followup_question: str = Field(max_length=500)
    grading_version: Literal['review-answer-reason-v1', 'review-single-pass-v2']
    source: Literal['ai_suggestion']
    issue: Literal['model_error', 'insufficient_material', 'unverified_evidence'] | None = None
    evaluation_completed: bool | None = None

    @model_validator(mode='after')
    def valid_outcome(self):
        a, e = self.assessment.answer.verdict, self.assessment.explanation.verdict
        if a not in ('correct', 'incorrect', 'uncertain') or e not in ('missing', 'valid', 'invalid', 'uncertain'):
            raise ValueError('判定类型不匹配')
        if self.evaluation_completed is None:
            self.evaluation_completed = self.status != 'awaiting_explanation'
        if not self.evaluation_completed:
            if self.status != 'awaiting_explanation' or e != 'missing' or self.is_correct is not None:
                raise ValueError('等待解释状态不一致')
            return self
        # 完成条件独立于对错：答案和解释都已经由 AI 作出判断才可切题。
        explanation_complete = e in ('valid', 'invalid') or (e == 'missing' and self.grading_version == 'review-single-pass-v2')
        complete = a in ('correct', 'incorrect') and explanation_complete
        status = 'final' if complete else 'needs_review' if 'uncertain' in (a, e) else 'awaiting_explanation'
        outcome = (a == 'correct' and e != 'invalid') if status == 'final' else None
        if self.status != status or self.is_correct is not outcome:
            raise ValueError('最终结果与分项判断不一致')
        return self


def validate_evidence(result, item, answer, explanation):
    if result.entry_id != item['id'] or result.source_fingerprint != source_fingerprint(item):
        raise HTTPException(409, '题目已修改，请重新作答')
    references = [item[key] for key in ('question', 'correct_answer', 'material')]
    complete = (item['question'].strip() and item['correct_answer'].strip() and
                not item['content_truncated'] and not item['has_visual_content'])
    for criterion, text in ((result.assessment.answer, answer), (result.assessment.explanation, explanation or answer)):
        if criterion.verdict in ('uncertain', 'missing'):
            continue
        if (not complete or not criterion.student_evidence or not criterion.reference_evidence or
            not all(quote.strip() and len(quote) <= 240 and quote in text for quote in criterion.student_evidence) or
            not all(quote.strip() and len(quote) <= 240 and any(quote in ref for ref in references)
                    for quote in criterion.reference_evidence)):
            raise ValueError('判卷依据不成立')
    if explanation.strip() and result.assessment.explanation.verdict == 'missing':
        raise ValueError('已收到解释不能忽略')


async def evaluate(item, answer, explanation, authorization):
    try:
        base = os.getenv('RAG_AGENT_URL', 'http://127.0.0.1:8001').rstrip('/')
        async with httpx.AsyncClient(timeout=65, trust_env=False) as client:
            response = await client.post(f'{base}/review/grade',
                json={'entry_id': item['id'], 'answer_text': answer, 'explanation_text': explanation},
                headers={'Authorization': authorization})
        if response.status_code in (401, 403, 404):
            raise HTTPException(response.status_code, '登录无效或题目不可用')
        response.raise_for_status()
        result = GradeResponse.model_validate(response.json())
        validate_evidence(result, item, answer, explanation)
        return result.model_dump()
    except httpx.TimeoutException as exc:
        raise HTTPException(504, '判卷超时，作答已保留，请重试') from exc
    except httpx.ConnectError as exc:
        raise HTTPException(503, '判卷服务未启动，作答已保留') from exc
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise HTTPException(502, '判卷结果未通过校验，作答已保留') from exc
