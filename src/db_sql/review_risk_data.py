"""登录范围内的风险模型适配；日志/模型身份不进入LLM提示词。"""
from functools import lru_cache
import os
from pathlib import Path

from sqlalchemy.orm import selectinload
from src.db_sql.models import NoteEntryModel, ReviewLogModel
from src.db_sql.review_risk import Event, History, identity, load_model


def load_events(db, user_ids, now_ms, approved_skills=None):
    rows = db.query(ReviewLogModel).join(NoteEntryModel).filter(
        NoteEntryModel.user_id.in_(user_ids), ReviewLogModel.timestamp <= now_ms,
        ReviewLogModel.is_correct.isnot(None)).options(
        selectinload(ReviewLogModel.entry).selectinload(NoteEntryModel.tags))
    approved = set(approved_skills) if approved_skills is not None else None
    events = []
    last_id = None
    while True:
        page = rows.filter(ReviewLogModel.id > last_id) if last_id is not None else rows
        batch = page.order_by(ReviewLogModel.id).limit(500).all()
        if not batch:
            break
        for row in batch:
            skills = tuple(sorted(tag.name for tag in row.entry.tags if approved is None or tag.name in approved))
            events.append(Event(identity(row.entry.user_id),identity(row.entry_id),row.timestamp,
                                row.is_correct,skills,row.id))
        last_id = batch[-1].id
    return events


@lru_cache(maxsize=4)
def _cached_model(path, modified, size):
    return load_model(path)


def current_model():
    path = os.getenv('REVIEW_RISK_MODEL_PATH','').strip()
    if not path:
        return None,'model_missing'
    try:
        resolved = Path(path).resolve()
        stat = resolved.stat()
        return _cached_model(str(resolved),stat.st_mtime_ns,stat.st_size),None
    except (OSError,ValueError,TypeError,KeyError):
        return None,'model_invalid'


def prediction_context(db,user_id,now_ms):
    model,reason = current_model()
    if model and model.validated and identity(user_id) in model.users and now_ms > model.trained_until:
        return model,History(load_events(db,[user_id],now_ms,model.skills)),reason
    return model,None,reason
