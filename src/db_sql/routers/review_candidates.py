"""复习助手只读候选接口：先限定账号/范围，再聚合作答记录并排序。"""
import re
import heapq
import math
from statistics import median
from html import unescape
from datetime import datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import case, false, func, or_
from sqlalchemy.orm import Session, selectinload

from src.db_sql.auth import get_current_user
from src.db_sql.database import get_db
from src.db_sql.models import NoteEntryModel, NotebookModel, ReviewLogModel, TagModel, QuestionGroupModel, UserModel
from src.db_sql.routers.learning_stats import LOCAL_TZ
from src.db_sql.review_risk import identity, predict_risk
from src.db_sql.review_risk_data import prediction_context

router = APIRouter(prefix='/api/review-agent', tags=['复习助手'])
DAY_MS = 86400000


class ReviewFilter(BaseModel):
    model_config = ConfigDict(extra='forbid')
    notebook_ids: list[str] = Field(default_factory=list, max_length=100)
    entry_ids: list[str] = Field(default_factory=list, max_length=20)
    knowledge_point: str = Field(default='', max_length=100)
    subject: str = Field(default='', max_length=100)
    scope: Literal['due', 'all'] = 'due'
    limit: int = Field(default=30, ge=1, le=50)


def plain(value, limit):
    text = re.sub(r'<(script|style)\b[^>]*>.*?</\1>', '', value or '', flags=re.S | re.I)
    return unescape(re.sub('<[^>]+>', ' ', text)).strip()[:limit]


def compute_candidates(db: Session, user_id: str, filters: ReviewFilter, now=None, *, related_points=None):
    now = now or datetime.now(LOCAL_TZ)
    now = now.astimezone(LOCAL_TZ)
    now_ms = int(now.timestamp() * 1000)
    start = int(datetime.combine(now.date(), time.min, LOCAL_TZ).timestamp() * 1000)
    end = start + DAY_MS
    base = db.query(NoteEntryModel).filter(NoteEntryModel.user_id == user_id)
    if filters.notebook_ids:
        owned = {row[0] for row in db.query(NotebookModel.id).filter(
            NotebookModel.user_id == user_id, NotebookModel.id.in_(filters.notebook_ids))}
        if owned != set(filters.notebook_ids):
            raise HTTPException(404, '错题本范围不可用')
        base = base.filter(NoteEntryModel.notebook_id.in_(filters.notebook_ids))
    if filters.entry_ids:
        owned = {row[0] for row in base.with_entities(NoteEntryModel.id).filter(NoteEntryModel.id.in_(filters.entry_ids))}
        if owned != set(filters.entry_ids):
            raise HTTPException(404, '所选题目已不可用或不属于当前范围')
        base = base.filter(NoteEntryModel.id.in_(filters.entry_ids))
    if filters.subject:
        base = base.filter(NoteEntryModel.subject == filters.subject)
    if related_points is not None:
        base = base.filter(or_(*(or_(NoteEntryModel.tags.any(TagModel.name == point),
            NoteEntryModel.title.contains(point, autoescape=True),
            NoteEntryModel.question.contains(point, autoescape=True)) for point in related_points)) if related_points else false())
    point = filters.knowledge_point.strip()
    if point:
        #精确标签或题干/标题字面匹配，不把关键词出现冒充知识点确认。
        base = base.filter(NoteEntryModel.tags.any(TagModel.name == point) |
            NoteEntryModel.title.contains(point, autoescape=True) |
            NoteEntryModel.question.contains(point, autoescape=True))
    if filters.scope == 'due':
        base = base.filter(NoteEntryModel.next_review_date.is_(None) | (NoteEntryModel.next_review_date < end))
    total = base.count()
    #全历史错误次数与近30天错误率分开；未知对错不进入分母，未来记录不计。
    recent = now_ms - 30 * DAY_MS
    logs = db.query(ReviewLogModel.entry_id.label('entry_id'),
        func.count(ReviewLogModel.id).label('review_count'),
        func.sum(case((ReviewLogModel.is_correct.is_(False), 1), else_=0)).label('incorrect'),
        func.sum(case((ReviewLogModel.is_correct.isnot(None), 1), else_=0)).label('judged'),
        func.sum(case(((ReviewLogModel.timestamp >= recent) & ReviewLogModel.is_correct.is_(False), 1), else_=0)).label('recent_incorrect'),
        func.sum(case(((ReviewLogModel.timestamp >= recent) & ReviewLogModel.is_correct.isnot(None), 1), else_=0)).label('recent_judged')
    ).filter(ReviewLogModel.entry_id.in_(base.with_entities(NoteEntryModel.id)),
             ReviewLogModel.timestamp <= now_ms).group_by(ReviewLogModel.entry_id).subquery()
    incorrect = func.coalesce(logs.c.incorrect, 0)
    recorded_reviews = func.coalesce(logs.c.review_count, 0)
    stored_reviews = func.coalesce(NoteEntryModel.review_count, 0)
    review_count = case((stored_reviews > recorded_reviews, stored_reviews), else_=recorded_reviews)
    recent_judged = func.coalesce(logs.c.recent_judged, 0)
    urgency = case((NoteEntryModel.next_review_date < start, 30.0),
                   (NoteEntryModel.next_review_date < end, 20.0),
                   (NoteEntryModel.next_review_date.is_(None), 10.0), else_=0.0)
    repeat = case((incorrect >= 5, 25.0), else_=incorrect * 5.0)
    recent_risk = case((recent_judged > 0, 15.0 * logs.c.recent_incorrect / recent_judged), else_=0.0)
    weakness = case((review_count == 0, 12.0),
        (NoteEntryModel.mastery_level.between(0, 4), 20.0 - 5.0 * NoteEntryModel.mastery_level), else_=10.0)
    score = urgency + repeat + recent_risk + weakness
    scored = base.outerjoin(logs, logs.c.entry_id == NoteEntryModel.id).add_columns(
        incorrect, func.coalesce(logs.c.judged, 0), func.coalesce(logs.c.recent_incorrect, 0), recent_judged,
        urgency, repeat, recent_risk, weakness, score, review_count
    ).options(selectinload(NoteEntryModel.tags))
    model,history,load_reason = prediction_context(db,user_id,now_ms)
    def risk_rows():
        last_id = None
        while True:
            page = scored.filter(NoteEntryModel.id > last_id) if last_id is not None else scored
            #分批关闭主查询后再加载标签，兼容MySQL驱动的单活动游标限制。
            batch = page.order_by(NoteEntryModel.id).limit(200).all()
            if not batch:
                break
            for row in batch:
                entry = row[0]
                risk = predict_risk(model,history,identity(user_id),identity(entry.id),
                    [tag.name for tag in entry.tags],now_ms,int(row[1]),int(row[2]),load_reason)
                yield tuple(row)+(risk,)
            last_id = batch[-1][0].id
    #对全部匹配题先计算风险再截取候选，不能先按旧的固定分数截断。
    rows = heapq.nsmallest(filters.limit,risk_rows(),key=lambda row:(
        -row[-1]['probability'], -float(row[5]),
        row[0].next_review_date if row[0].next_review_date is not None else start,row[0].id))
    durations = {}
    ids = [row[0].id for row in rows]
    if ids:
        for entry_id, elapsed in db.query(ReviewLogModel.entry_id,ReviewLogModel.elapsed_ms).filter(
                ReviewLogModel.entry_id.in_(ids),ReviewLogModel.timestamp <= now_ms,
                ReviewLogModel.elapsed_ms.between(1,1800000)).order_by(ReviewLogModel.timestamp.desc()).yield_per(500):
            values = durations.setdefault(entry_id,[])
            if len(values) < 20:
                values.append(elapsed)
    group_ids = {row[0].group_id for row in rows if row[0].group_id}
    groups = {row.id: row for row in db.query(QuestionGroupModel).join(NotebookModel)
        .filter(NotebookModel.user_id == user_id, QuestionGroupModel.id.in_(group_ids)).all()} if group_ids else {}
    items = []
    for entry, wrong, judged, recent_wrong, recent_total, u, r, recent_score, weak, base_score, reviews, risk in rows:
        tags = sorted(tag.name for tag in entry.tags)
        status = ('overdue' if entry.next_review_date is not None and entry.next_review_date < start else
                  'today' if entry.next_review_date is not None and entry.next_review_date < end else
                  'unscheduled' if entry.next_review_date is None else 'future')
        group = groups.get(entry.group_id)
        items.append({'id': entry.id, 'notebook_id': entry.notebook_id, 'title': entry.title,
            'subject': entry.subject, 'tags': tags, 'question': plain(entry.question, 5000),
            'wrong_answer': plain(entry.wrong_answer, 3000), 'correct_answer': plain(entry.correct_answer, 5000),
            'material': plain(group.material, 3000) if group and group.notebook_id == entry.notebook_id else '',
            'content_truncated': any(len(plain(value, 100000)) > cap for value, cap in (
                (entry.question, 5000), (entry.wrong_answer, 3000), (entry.correct_answer, 5000),
                (group.material if group else '', 3000))),
            'has_visual_content': bool(entry.drawings or (group and group.drawings) or re.search(r'<img\b', entry.question or '', re.I)),
            'due_status': status, 'next_review_date': entry.next_review_date,
            'mastery_level': entry.mastery_level if reviews else -1,
            'review_count': int(reviews), 'wrong_count': int(wrong),
            'learning_tags': [f'复习{int(reviews)}次', f'答错{int(wrong)}次'],
            'incorrect_count': int(wrong), 'judged_count': int(judged),
            'recent_incorrect_count': int(recent_wrong), 'recent_judged_count': int(recent_total),
            'match_basis': 'exact_tag' if point in tags else 'text_mention' if point else 'scope',
            'base_score': round(float(base_score), 4),
            'risk': risk,
            'estimated_seconds': max(60,min(1800,math.ceil(median(durations[entry.id])/1000))) if durations.get(entry.id) else 300,
            'time_estimate_source': 'history_median' if durations.get(entry.id) else 'default',
            'score_components': {'urgency': float(u), 'repeated_errors': float(r),
                'recent_error_rate': round(float(recent_score), 4), 'mastery': float(weak)}})
    return {'source': 'mysql', 'timezone': 'Asia/Shanghai', 'as_of': now.isoformat(),
        'filters': filters.model_dump(), 'total_count': total, 'candidate_limit': filters.limit,
        'truncated': total > len(items), 'items': items,
        'ranking_version': 'review-v2', 'definitions': {
            'due': '下次复习时间早于今日结束（包含逾期）；未安排时间的题也列入；不按收录日期筛选',
            'incorrect_count': '已记录is_correct=false的复习作答次数，不是考试做错次数',
            'wrong_count': '同incorrect_count；只有明确答错才累计，掌握评级不代表作答对错',
            'review_count': '复习模式中已提交结果的累计次数，与掌握程度和连续掌握次数独立',
            'base_score': '保留旧固定分项用于兼容与诊断，不再用于风险排序',
            'risk': '通过评估门槛的DAS3H预测，或Beta-Binomial回退；没有作答记录时只有先验，不能显示成实际错误率',
            'estimated_seconds': '最近最多20次有效用时的中位数，限制60到1800秒；没有记录默认300秒，均为预算估计',
            'importance': '数据库没有题目重要性字段；后续教学建议使用中性/基础/综合权重1/1.25/1.5，与风险分开',
            'match': 'exact_tag为已标注知识点；text_mention仅为题干/标题字面出现，不能断言知识点已确认'}}


@router.post('/review-candidates')
def review_candidates(filters: ReviewFilter, user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    return compute_candidates(db, user.id, filters)


class RelatedFilter(BaseModel):
    model_config = ConfigDict(extra='forbid')
    anchor_entry_id: str = Field(min_length=1, max_length=64)
    concepts: list[str] = Field(default_factory=list, max_length=6)
    limit: int = Field(default=50, ge=1, le=50)


@router.post('/related-candidates')
def related_candidates(payload: RelatedFilter, user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    anchor = db.query(NoteEntryModel).filter(NoteEntryModel.id == payload.anchor_entry_id,
                                           NoteEntryModel.user_id == user.id).first()
    if not anchor:
        raise HTTPException(404, '题目不可用')
    if any(not point.strip() or len(point) > 60 for point in payload.concepts):
        raise HTTPException(422, '知识点查询条件无效')
    points = list(dict.fromkeys([tag.name for tag in anchor.tags] + [point.strip() for point in payload.concepts]))[:20]
    filters = ReviewFilter(notebook_ids=[anchor.notebook_id], scope='all', limit=payload.limit)
    # 标签和词项只是召回线索；题目关联必须再由双题原文证据核对。
    return compute_candidates(db, user.id, filters, related_points=points)


class RandomFilter(BaseModel):
    model_config = ConfigDict(extra='forbid')
    anchor_entry_id: str = Field(min_length=1, max_length=64)
    exclude_entry_ids: list[str] = Field(default_factory=list, max_length=50)
    limit: int = Field(default=3, ge=1, le=20)


@router.post('/random-candidates')
def random_candidates(payload: RandomFilter, user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    anchor = db.query(NoteEntryModel).filter(NoteEntryModel.id == payload.anchor_entry_id,
                                           NoteEntryModel.user_id == user.id).first()
    if not anchor:
        raise HTTPException(404, '题目不可用')
    excluded = set(payload.exclude_entry_ids) | {anchor.id}
    eligible = db.query(NoteEntryModel.id).filter(NoteEntryModel.user_id == user.id,
        NoteEntryModel.notebook_id == anchor.notebook_id, NoteEntryModel.id.notin_(excluded))
    total = eligible.count()
    # 在整个当前错题本随机抽取，不能先截取风险最高的候选再打乱。
    random_order = func.rand() if db.get_bind().dialect.name in ('mysql', 'mariadb') else func.random()
    ids = [row[0] for row in eligible.order_by(random_order).limit(payload.limit).all()]
    filters = ReviewFilter(notebook_ids=[anchor.notebook_id], scope='all', limit=payload.limit)
    selected = filters.model_copy(update={'entry_ids': ids})
    result = compute_candidates(db, user.id, selected, related_points=None if ids else [])
    result.update(filters=filters.model_dump(), total_count=total, truncated=total > len(result['items']))
    return result
