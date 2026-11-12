import time

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy.orm import Session

from src.db_sql.auth import get_current_user
from src.db_sql.crud import owned_entry
from src.db_sql.database import get_db
from src.db_sql.models import UserModel
from src.db_sql.review_bundle import request_bundle, validate_bundle, sign_draft, verify_draft
from src.db_sql.review_importance import source_fingerprint
from src.db_sql.routers.review_candidates import compute_candidates, ReviewFilter
from src.db_sql.routers.review_insights import selected_candidate

router = APIRouter(prefix='/api/entries', tags=['关联复习组题'])


class BundleOptions(BaseModel):
    model_config = ConfigDict(extra='forbid')
    limit: StrictInt = Field(default=10, ge=4, le=10)


class ConfirmBundle(BaseModel):
    model_config = ConfigDict(extra='forbid')
    proposal_token: str = Field(min_length=1, max_length=20000)


@router.post('/{entry_id}/review-bundle')
async def prepare(entry_id: str, payload: BundleOptions, user: UserModel = Depends(get_current_user),
                  db: Session = Depends(get_db), authorization: str = Header(default='')):
    user_id = user.id
    initial, _ = selected_candidate(db, user_id, entry_id)
    db.rollback()
    result = await request_bundle(entry_id, payload.limit, authorization)
    db.expire_all()
    ids = [item.entry_id for item in result.items]
    data = compute_candidates(db, user_id, ReviewFilter(notebook_ids=[initial['notebook_id']], entry_ids=ids, scope='all', limit=10))
    sources = {row['id']: row for row in data['items']}
    anchor = sources.get(entry_id)
    if not anchor:
        raise HTTPException(502, '复习组缺少当前题目')
    try:
        validate_bundle(result, anchor, sources, payload.limit)
    except ValueError as exc:
        raise HTTPException(502, '复习组关联依据未通过校验') from exc
    # 重新读取的风险/用时才是业务事实；排序以当前题为首，其他题按风险×教学重要性。
    weights = {'unknown':1.0, 'ordinary':1.0, 'foundational':1.25, 'integrative':1.5}
    others = sorted(result.items[1:], key=lambda item: -sources[item.entry_id]['risk']['probability']*weights[item.importance.importance])
    ordered = [result.items[0]]+others
    rows = [sources[item.entry_id] for item in ordered]
    token, expires = sign_draft(user_id, entry_id, anchor['notebook_id'], rows)
    items = []
    for item, row in zip(ordered, rows):
        items.append({'entry_id': item.entry_id, 'title': row['title'], 'question_preview': row['question'][:120],
            'knowledge_points': row['tags'], 'estimated_seconds': row['estimated_seconds'],
            'review_count': row['review_count'], 'wrong_count': row['wrong_count'],
            'relation': item.relation.model_dump(), 'importance': item.importance.model_dump()})
    notices = []
    notices.extend(result.relation_warnings)
    if result.relation_status in ('complete', 'partial'):
        notices.append(f'本次候选中有 {result.related_count} 道通过关联核验，按优先级选入，题组总数最多 10 道。')
    if result.retrieval:
        if result.retrieval.hydrated_count:
            notices.append(f'已从入库索引按题意、解题结构和知识关联召回 {result.retrieval.hydrated_count} 道候选题。')
        notices.extend(result.retrieval.warnings)
    if len(items) == 1:
        notices.append('当前错题本没有其他可召回题目，本次只安排原题。')
    elif len(items) < 4:
        notices.append('当前错题本可召回题目不足 3 道，已加入实际召回的题目。')
    if any(item.relation.relation == 'recalled' for item in ordered):
        notices.append('已保留召回补充题；补充题尚未确认与原题的知识点关联。')
    if any(item.relation.reason.startswith('随机补充：') for item in ordered):
        notices.append('关联候选不足，已从当前错题本随机补题，排除了原题和已选题。')
    if result.candidate_truncated:
        notices.append('本次候选范围最多 50 道，题组总数最多 10 道。')
    return {'anchor_entry_id': entry_id, 'notebook_id': anchor['notebook_id'], 'proposal_token': token,
            'expires_at': expires, 'items': items, 'estimated_seconds': sum(row['estimated_seconds'] for row in rows),
            'notices': notices, 'bundle_version': 'related-review-v1',
            'retrieval': result.retrieval.model_dump() if result.retrieval else None}


@router.post('/{entry_id}/review-bundle/confirm')
def confirm(entry_id: str, payload: ConfirmBundle, user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = owned_entry(db, entry_id, user.id)
    draft = verify_draft(payload.proposal_token, user.id, entry_id)
    if entry.notebook_id != draft['notebook']:
        raise HTTPException(409, '题目范围已修改，请重新组题')
    ids = [item['id'] for item in draft['items']]
    data = compute_candidates(db, user.id, ReviewFilter(notebook_ids=[draft['notebook']], entry_ids=ids, scope='all', limit=10))
    sources = {row['id']: row for row in data['items']}
    if any(source_fingerprint(sources[item['id']]) != item['hash'] for item in draft['items']):
        raise HTTPException(409, '复习题已修改，请重新组题')
    return {'anchor_entry_id': entry_id, 'notebook_id': draft['notebook'], 'entry_ids': ids,
            'confirmed_at': int(time.time()*1000), 'bundle_version': 'related-review-v1'}
