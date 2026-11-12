"""Small, account-scoped dashboard aggregates; never load question content."""

from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from src.db_sql.models import NoteEntryModel, NotebookModel, ReviewLogModel

DAY_MS = 86400000


class PendingEntry(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str
    notebook_id: str
    subject: str = ''
    next_review_date: int | None = None
    updated_at: int = 0


class PendingReview(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str
    entry_id: str
    timestamp: int


class OverviewRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    utc_offset_minutes: int = Field(default=480, ge=-840, le=840)
    notebook_ids: list[str] | None = None
    entries: list[PendingEntry] = Field(default_factory=list)
    deleted_entry_ids: list[str] = Field(default_factory=list)
    reviews: list[PendingReview] = Field(default_factory=list)
    local_entries: list[PendingEntry] = Field(default_factory=list)
    local_reviews: list[PendingReview] = Field(default_factory=list)


def notebook_overview(db: Session, user_id: str, request: OverviewRequest, *, now: int | None = None):
    now = now if now is not None else int(datetime.now(timezone.utc).timestamp() * 1000)
    tz = timezone(timedelta(minutes=request.utc_offset_minutes))
    today = datetime.fromtimestamp(now / 1000, tz).replace(hour=0, minute=0, second=0, microsecond=0)
    start = int(today.timestamp() * 1000)
    week_start = start - 6 * DAY_MS
    notebooks = db.query(NotebookModel.id).filter(NotebookModel.user_id == user_id)
    if request.notebook_ids is not None:
        notebooks = notebooks.filter(NotebookModel.id.in_(request.notebook_ids))
    items = {row.id: dict(notebookId=row.id, entryCount=0, dueCount=0, reviewedToday=0)
             for row in notebooks.all()}
    # Pending writes are projected onto the read result so returning home after an
    # offline edit does not lose a question or count a just-synced review twice.
    deleted = set(request.deleted_entry_ids)
    projected = {}
    if request.local_entries:
        local = {entry.id: entry for entry in request.local_entries
                 if entry.notebook_id in items and entry.id not in deleted}
        versions = dict(db.query(NoteEntryModel.id, NoteEntryModel.updated_at).filter(
            NoteEntryModel.user_id == user_id, NoteEntryModel.id.in_(local)).all())
        projected.update({entry.id: entry for entry in local.values()
                          if entry.id not in versions or entry.updated_at > (versions[entry.id] or 0)})
    projected.update({entry.id: entry for entry in request.entries
                 if entry.notebook_id in items and entry.id not in deleted}
    )
    entries = db.query(NoteEntryModel).filter(
        NoteEntryModel.user_id == user_id, NoteEntryModel.notebook_id.in_(items),
        NoteEntryModel.id.notin_(deleted | projected.keys()))
    due = (NoteEntryModel.next_review_date > 0) & (NoteEntryModel.next_review_date <= now)
    for notebook_id, count, due_count in entries.with_entities(
            NoteEntryModel.notebook_id, func.count(), func.sum(case((due, 1), else_=0))
    ).group_by(NoteEntryModel.notebook_id).all():
        items[notebook_id].update(entryCount=count, dueCount=int(due_count or 0))
    subjects = {name or '未分类': count for name, count in entries.with_entities(
        func.coalesce(func.nullif(NoteEntryModel.subject, ''), '未分类'), func.count()
    ).group_by(func.coalesce(func.nullif(NoteEntryModel.subject, ''), '未分类')).all()}
    for entry in projected.values():
        item = items[entry.notebook_id]
        item['entryCount'] += 1
        item['dueCount'] += int(bool(entry.next_review_date and 0 < entry.next_review_date <= now))
        subject = entry.subject or '未分类'
        subjects[subject] = subjects.get(subject, 0) + 1

    reviews = db.query(ReviewLogModel).join(NoteEntryModel).filter(
        NoteEntryModel.user_id == user_id, NoteEntryModel.notebook_id.in_(items),
        NoteEntryModel.id.notin_(deleted), ReviewLogModel.timestamp >= week_start,
        ReviewLogModel.timestamp <= now)
    for notebook_id, count in reviews.filter(ReviewLogModel.timestamp >= start).with_entities(
            NoteEntryModel.notebook_id, func.count()
    ).group_by(NoteEntryModel.notebook_id).all():
        items[notebook_id]['reviewedToday'] = count
    day_index = func.floor((ReviewLogModel.timestamp - week_start) / DAY_MS)
    days = [dict(timestamp=week_start + i * DAY_MS, count=0) for i in range(7)]
    for index, count in reviews.with_entities(day_index, func.count()).group_by(day_index).all():
        days[int(index)]['count'] = count

    if request.reviews or request.local_reviews:
        pending = {log.id: log for log in [*request.local_reviews, *request.reviews]}
        existing = {row.id for row in db.query(ReviewLogModel.id).join(NoteEntryModel).filter(
            NoteEntryModel.user_id == user_id, ReviewLogModel.id.in_(pending)).all()}
        entry_ids = {log.entry_id for log in pending.values()}
        owners = dict(db.query(NoteEntryModel.id, NoteEntryModel.notebook_id).filter(
            NoteEntryModel.user_id == user_id, NoteEntryModel.id.in_(entry_ids)).all())
        owners.update({entry.id: entry.notebook_id for entry in projected.values()})
        for log in pending.values():
            notebook_id = owners.get(log.entry_id)
            if (log.id in existing or log.entry_id in deleted or notebook_id not in items
                    or not week_start <= log.timestamp <= now):
                continue
            days[(log.timestamp - week_start) // DAY_MS]['count'] += 1
            if log.timestamp >= start:
                items[notebook_id]['reviewedToday'] += 1
    return dict(items=list(items.values()), subjects=[dict(name=name, count=count)
                for name, count in sorted(subjects.items(), key=lambda row: (-row[1], row[0]))],
                reviewDays=days)
