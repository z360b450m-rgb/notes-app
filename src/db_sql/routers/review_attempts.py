"""持久化判卷状态机；最终日志与计数在同一事务写入，并支持幂等重试。"""
import json
import time
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.db_sql.auth import get_current_user
from src.db_sql.crud import owned_entry, serialize_review_log
from src.db_sql.database import get_db
from src.db_sql.models import UserModel, NoteEntryModel, ReviewLogModel, ReviewAttemptModel
from src.db_sql.review_grading import evaluate
from src.db_sql.review_importance import source_fingerprint
from src.db_sql.routers.review_insights import selected_candidate

router = APIRouter(prefix='/api/entries', tags=['复习判卷'])


class AttemptCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    attempt_id: UUID
    answer_text: str = Field(min_length=1, max_length=20000)
    elapsed_ms: StrictInt = Field(default=0, ge=0, le=86400000)

    @field_validator('answer_text')
    @classmethod
    def nonempty(cls, text):
        if not text.strip():
            raise ValueError('请填写作答')
        return text.strip()


class ExplanationCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    explanation_text: str = Field(min_length=1, max_length=20000)
    expected_revision: StrictInt = Field(ge=0)

    @field_validator('explanation_text')
    @classmethod
    def nonempty(cls, text):
        if not text.strip():
            raise ValueError('请说明解题理由')
        return text.strip()


def get_attempt(db, entry_id, user_id, attempt_id, lock=False):
    query = db.query(ReviewAttemptModel).filter(ReviewAttemptModel.id == str(attempt_id),
        ReviewAttemptModel.entry_id == entry_id, ReviewAttemptModel.user_id == user_id)
    if lock:
        query = query.populate_existing().with_for_update()
    attempt = query.first()
    if not attempt:
        raise HTTPException(404, '作答记录不可用')
    return attempt


def present(db, attempt):
    result = attempt.result or {}
    assessment = result.get('assessment') or {}
    response = {'attempt_id': attempt.id, 'entry_id': attempt.entry_id, 'revision': attempt.revision,
        'status': attempt.status, 'is_correct': result.get('is_correct') if attempt.status == 'final' else None,
        'answer_verdict': assessment.get('answer', {}).get('verdict', 'uncertain'),
        'explanation_verdict': assessment.get('explanation', {}).get('verdict', 'uncertain'),
        'comment': result.get('comment', '作答已保留，等待完成判卷。'),
        'followup_question': result.get('followup_question', ''),
        'issue': result.get('issue'),
        'evaluation_completed': bool(result) and result.get('evaluation_completed', attempt.status in ('final', 'needs_review')),
        'grading_version': result.get('grading_version', 'review-answer-reason-v1'),
        'answer_text': attempt.answer_text, 'explanation_text': attempt.explanation_text,
        'review_log': None, 'entry_review': None}
    if attempt.status == 'final':
        log = db.get(ReviewLogModel, attempt.id)
        if not log:
            raise HTTPException(503, '复习结果需要核对，请稍后重试')
        entry = owned_entry(db, attempt.entry_id, attempt.user_id)
        now = int(time.time()*1000)
        wrong = db.query(func.count(ReviewLogModel.id)).filter(ReviewLogModel.entry_id == entry.id,
            ReviewLogModel.timestamp <= now, ReviewLogModel.is_correct.is_(False)).scalar()
        response.update(review_log=serialize_review_log(log), entry_review={
            'review_count': entry.review_count, 'wrong_count': wrong,
            'last_review_date': entry.last_review_date, 'updated_at': entry.updated_at})
    return response


async def run_grading(db, entry_id, user_id, attempt_id, authorization, *, explanation=None, expected_revision=None):
    item, _ = selected_candidate(db, user_id, entry_id)
    attempt = get_attempt(db, entry_id, user_id, attempt_id, lock=True)
    if attempt.result and (attempt.status in ('final', 'needs_review') or attempt.result.get('evaluation_completed')):
        return present(db, attempt)
    now = int(time.time()*1000)
    if source_fingerprint(item) != attempt.source_fingerprint:
        raise HTTPException(409, '题目已修改，请重新作答')
    if attempt.status == 'grading' and attempt.lease_until > now:
        raise HTTPException(409, '这次作答正在判卷，请稍后重试')
    if explanation is None and attempt.status == 'awaiting_explanation':
        return present(db, attempt)
    if explanation is not None:
        same_retry = (attempt.explanation_text == explanation and
                      expected_revision == attempt.revision-1 and attempt.status in ('retryable', 'grading'))
        if expected_revision != attempt.revision and not same_retry:
            raise HTTPException(409, '作答状态已更新，请重新读取后提交理由')
        attempt.explanation_text = explanation
    attempt.status = 'grading'
    attempt.revision += 1
    attempt.lease_until = now + 90000
    attempt.updated_at = now
    revision, answer, reason = attempt.revision, attempt.answer_text, attempt.explanation_text
    db.commit()  # 模型调用期间释放连接，不持有业务锁/旧 MySQL 快照。
    try:
        result = await evaluate(item, answer, reason, authorization)
    except HTTPException:
        failed = get_attempt(db, entry_id, user_id, attempt_id, lock=True)
        if failed.status == 'grading' and failed.revision == revision:
            failed.status = 'retryable'
            failed.lease_until = 0
            db.commit()
        raise
    db.expire_all()
    entry = db.query(NoteEntryModel).filter(NoteEntryModel.id == entry_id,
        NoteEntryModel.user_id == user_id).with_for_update().first()
    if not entry:
        raise HTTPException(404, '题目不可用')
    attempt = get_attempt(db, entry_id, user_id, attempt_id, lock=True)
    if attempt.status == 'final':
        return present(db, attempt)
    if attempt.revision != revision or attempt.status != 'grading':
        raise HTTPException(409, '作答状态已更新，请重新读取')
    current, _ = selected_candidate(db, user_id, entry_id)
    if source_fingerprint(current) != attempt.source_fingerprint:
        attempt.status = 'retryable'
        attempt.lease_until = 0
        db.commit()
        raise HTTPException(409, '题目已修改，请重新作答')
    attempt.result = result
    attempt.status = result['status']
    attempt.lease_until = 0
    attempt.updated_at = int(time.time()*1000)
    if attempt.status == 'final':
        # ID 使用 attempt UUID；同一事务、主键约束和行锁确保一份最终日志。
        if db.get(ReviewLogModel, attempt.id):
            raise HTTPException(409, '复习记录 ID 不可用')
        count = db.query(func.count(ReviewLogModel.id)).filter(ReviewLogModel.entry_id == entry_id,
                                                             ReviewLogModel.timestamp <= attempt.updated_at).scalar()
        entry.review_count = max(entry.review_count or 0, count) + 1
        entry.last_review_date = attempt.updated_at
        entry.updated_at = attempt.updated_at
        db.add(ReviewLogModel(id=attempt.id, entry_id=entry_id, timestamp=attempt.updated_at,
            quality='agent_correct' if result['is_correct'] else 'agent_incorrect', is_correct=result['is_correct'],
            elapsed_ms=attempt.elapsed_ms, answer_text=answer,
            review_note=json.dumps({'source': 'agent_grading', 'grading_version': result['grading_version'],
                'explanation_text': reason, 'assessment': result['assessment'], 'comment': result['comment']}, ensure_ascii=False)))
    db.commit()
    return present(db, attempt)


@router.post('/{entry_id}/review-attempts')
async def submit_answer(entry_id: str, payload: AttemptCreate, db: Session = Depends(get_db),
                        user: UserModel = Depends(get_current_user), authorization: str = Header(default='')):
    user_id = user.id
    item, _ = selected_candidate(db, user_id, entry_id)
    attempt = db.get(ReviewAttemptModel, str(payload.attempt_id))
    if attempt:
        if attempt.entry_id != entry_id or attempt.user_id != user_id:
            raise HTTPException(404, '作答记录不可用')
        if attempt.answer_text != payload.answer_text:
            raise HTTPException(409, '首次作答已固定，修改答案请开始新的作答')
    else:
        now = int(time.time()*1000)
        db.add(ReviewAttemptModel(id=str(payload.attempt_id), entry_id=entry_id, user_id=user_id,
            source_fingerprint=source_fingerprint(item), answer_text=payload.answer_text,
            explanation_text='', elapsed_ms=payload.elapsed_ms, status='ready', revision=0,
            lease_until=0, created_at=now, updated_at=now))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            attempt = get_attempt(db, entry_id, user_id, payload.attempt_id)
            if attempt.answer_text != payload.answer_text:
                raise HTTPException(409, '作答内容已固定')
    return await run_grading(db, entry_id, user_id, payload.attempt_id, authorization)


@router.post('/{entry_id}/review-attempts/{attempt_id}/explanation')
async def submit_explanation(entry_id: str, attempt_id: UUID, payload: ExplanationCreate,
                             db: Session = Depends(get_db), user: UserModel = Depends(get_current_user),
                             authorization: str = Header(default='')):
    return await run_grading(db, entry_id, user.id, attempt_id, authorization,
                            explanation=payload.explanation_text, expected_revision=payload.expected_revision)


@router.get('/{entry_id}/review-attempts/{attempt_id}')
def read_attempt(entry_id: str, attempt_id: UUID, db: Session = Depends(get_db), user: UserModel = Depends(get_current_user)):
    owned_entry(db, entry_id, user.id)
    return present(db, get_attempt(db, entry_id, user.id, attempt_id))
