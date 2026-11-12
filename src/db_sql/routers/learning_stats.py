"""当前账号的只读学习统计，筛选参数固定，禁止模型提供SQL。"""

import re
from urllib.parse import quote
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from src.db_sql.auth import get_current_user
from src.db_sql.database import get_db
from src.db_sql.models import NoteEntryModel, NotebookModel, ReviewLogModel, TagModel, UserModel

router = APIRouter(prefix='/api/review-agent', tags=['复习助手'])
LOCAL_TZ = timezone(timedelta(hours=8))
DAY_MS = 86400000


class StatsFilter(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['overview', 'entries', 'reviews'] = 'overview'
    subject: str = Field(default='', max_length=100)
    tag: str = Field(default='', max_length=100)
    notebook: str = Field(default='', max_length=255)
    keyword: str = Field(default='', max_length=100)
    date_from: date | None = None
    date_to: date | None = None
    limit: int = Field(default=20, ge=1, le=50)
    compare_previous: bool = False

    @model_validator(mode='after')
    def valid_dates(self):
        if self.date_from and self.date_to and self.date_from >= self.date_to:
            raise ValueError('结束日期必须晚于开始日期，结束日期不包含在范围内')
        if self.compare_previous and (not self.date_from or not self.date_to):
            raise ValueError('比较上一时段需要完整日期范围')
        return self


def milliseconds(value: date) -> int:
    return int(datetime.combine(value, time.min, LOCAL_TZ).timestamp() * 1000)


def filtered_entries(db: Session, user_id: str, filters: StatsFilter):
    query = db.query(NoteEntryModel).filter(NoteEntryModel.user_id == user_id)
    if filters.subject:
        query = query.filter(NoteEntryModel.subject == filters.subject)
    if filters.tag:
        query = query.filter(NoteEntryModel.tags.any(TagModel.name == filters.tag))
    if filters.notebook:
        query = query.join(NotebookModel).filter(NotebookModel.name == filters.notebook)
    if filters.keyword:
        query = query.filter(NoteEntryModel.title.contains(filters.keyword, autoescape=True) |
                             NoteEntryModel.question.contains(filters.keyword, autoescape=True))
    return query


def within(query, column, start, end):
    if start is not None:
        query = query.filter(column >= start)
    if end is not None:
        query = query.filter(column < end)
    return query


def distribution(query, column):
    return [{'name': '未填写' if name is None or name == '' else name, 'count': count}
            for name, count in query.with_entities(column, func.count()).group_by(column)
            .order_by(func.count().desc(), column).limit(100).all()]


def daily(query, column):
    day = func.floor((column + 8 * 3600000) / DAY_MS)
    rows = query.with_entities(day, func.count()).group_by(day).order_by(day.desc()).limit(180).all()
    return [{'date': (date(1970, 1, 1) + timedelta(days=int(value))).isoformat(), 'count': count}
            for value, count in reversed(rows)]


def compute_stats(db: Session, user_id: str, filters: StatsFilter):
    #1.所有查询先限定所属账号；日期分别作用于收录时间和复习时间。
    base = filtered_entries(db, user_id, filters)
    start = milliseconds(filters.date_from) if filters.date_from else None
    end = milliseconds(filters.date_to) if filters.date_to else None
    entries = within(base, NoteEntryModel.created_at, start, end)
    reviews_base = db.query(ReviewLogModel).join(NoteEntryModel).filter(
        NoteEntryModel.id.in_(base.with_entities(NoteEntryModel.id)))
    reviews = within(reviews_base, ReviewLogModel.timestamp, start, end)
    judged = reviews.filter(ReviewLogModel.is_correct.isnot(None)).count()
    correct = reviews.filter(ReviewLogModel.is_correct.is_(True)).count()
    incorrect = reviews.filter(ReviewLogModel.is_correct.is_(False)).count()
    now = int(datetime.now(LOCAL_TZ).timestamp() * 1000)
    mastery = case(((NoteEntryModel.mastery_level == 0) &
                    (func.coalesce(NoteEntryModel.review_count, 0) == 0), -1),
                   else_=NoteEntryModel.mastery_level)

    #2.确定性聚合数字，空数据的正确率返回null，不冒充0%。
    result = {
        'source': 'mysql', 'filters': filters.model_dump(mode='json'),
        'timezone': 'Asia/Shanghai',
        'definitions': {
            'entries': '错题条目数量；日期按收录时间，不代表考试做错次数',
            'reviews': '复习作答记录次数；日期按复习时间',
            'accuracy': 'is_correct=true次数/有明确对错的复习次数，未知对错不计入分母',
            'tags': '现有标签分布，标签未标注时不能推断知识点；一题可有多个标签',
            'due': '符合收录日期筛选的条目中，已到复习时间或尚未安排复习的数量',
        },
        'entry_count': entries.count(), 'review_count': reviews.count(),
        'correct_count': correct, 'incorrect_count': incorrect,
        'judged_count': judged, 'accuracy_percent': round(correct / judged * 100, 2) if judged else None,
        'due_count': entries.filter((NoteEntryModel.next_review_date.is_(None)) |
                                   (NoteEntryModel.next_review_date <= now)).count(),
        'subjects': distribution(entries, NoteEntryModel.subject),
        'mastery': distribution(entries, mastery),
        'entry_daily': daily(entries, NoteEntryModel.created_at),
        'review_daily': daily(reviews, ReviewLogModel.timestamp),
        'distribution_limit': 100, 'daily_limit': 180,
    }
    tags = db.query(TagModel.name, func.count()).join(TagModel.entries).filter(
        NoteEntryModel.id.in_(entries.with_entities(NoteEntryModel.id)))
    result['tags'] = [{'name': name, 'count': count} for name, count in
                      tags.group_by(TagModel.name).order_by(func.count().desc(), TagModel.name).limit(100).all()]
    if filters.compare_previous:
        previous_start = start - (end - start)
        result['previous_period'] = {
            'date_from': (filters.date_from - (filters.date_to - filters.date_from)).isoformat(),
            'date_to': filters.date_from.isoformat(),
            'entry_count': within(base, NoteEntryModel.created_at, previous_start, start).count(),
            'review_count': within(reviews_base, ReviewLogModel.timestamp, previous_start, start).count(),
            'incorrect_count': within(reviews_base, ReviewLogModel.timestamp, previous_start, start)
                              .filter(ReviewLogModel.is_correct.is_(False)).count(),
        }

    #3.列表有明确上限，不把全部题干或用户账号字段传给模型。
    if filters.kind == 'entries':
        rows = entries.order_by(NoteEntryModel.created_at.desc(), NoteEntryModel.id).limit(filters.limit).all()
        result['items'] = [{
            'id': row.id, 'title': row.title, 'subject': row.subject,
            'notebook_id': row.notebook_id,
            'url': f'#/notebooks/{quote(row.notebook_id, safe="")}/entries/{quote(row.id, safe="")}',
            'question_preview': re.sub('<[^>]+>', '', row.question or '')[:200],
            'created_at': datetime.fromtimestamp(row.created_at / 1000, LOCAL_TZ).isoformat(),
        } for row in rows]
        result['truncated'] = result['entry_count'] > len(rows)
    elif filters.kind == 'reviews':
        rows = reviews.order_by(ReviewLogModel.timestamp.desc(), ReviewLogModel.id).limit(filters.limit).all()
        result['items'] = [{
            'entry_id': row.entry_id, 'is_correct': row.is_correct,
            'notebook_id': row.entry.notebook_id,
            'url': f'#/notebooks/{quote(row.entry.notebook_id, safe="")}/entries/{quote(row.entry_id, safe="")}',
            'timestamp': datetime.fromtimestamp(row.timestamp / 1000, LOCAL_TZ).isoformat(),
        } for row in rows]
        result['truncated'] = result['review_count'] > len(rows)
    return result


@router.post('/stats')
def learning_stats(filters: StatsFilter, user: UserModel = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    return compute_stats(db, user.id, filters)
