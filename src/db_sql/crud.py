import time
import uuid
import json
from typing import Any, Dict, Iterable, List, Optional

from fastapi import HTTPException
from sqlalchemy import or_, func, case
from sqlalchemy.orm import Session, load_only, selectinload

from src.db_sql.models import NotebookModel, NoteEntryModel, QuestionGroupModel, ReviewLogModel, TagModel


def owned_notebook(db: Session, notebook_id: str, user_id: str) -> NotebookModel:
    notebook = db.query(NotebookModel).filter(
        NotebookModel.id == notebook_id, NotebookModel.user_id == user_id
    ).first()
    if not notebook:
        raise HTTPException(status_code=404, detail="笔记本未找到")
    return notebook


def owned_entry(db: Session, entry_id: str, user_id: str) -> NoteEntryModel:
    entry = db.query(NoteEntryModel).filter(
        NoteEntryModel.id == entry_id, NoteEntryModel.user_id == user_id
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="错题未找到")
    return entry


def owned_group(db: Session, group_id: str, user_id: str) -> QuestionGroupModel:
    group = db.query(QuestionGroupModel).join(NotebookModel).filter(
        QuestionGroupModel.id == group_id, NotebookModel.user_id == user_id
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="题组未找到")
    return group


def check_group(db: Session, group_id: Optional[str], notebook_id: str, user_id: str) -> None:
    if group_id and owned_group(db, group_id, user_id).notebook_id != notebook_id:
        raise HTTPException(status_code=400, detail="题组必须属于同一个笔记本")


def normalize_tags(tags: Optional[Iterable[str]]) -> List[str]:
    normalized: List[str] = []
    seen = set()

    for raw_tag in tags or []:
        if raw_tag is None:
            continue

        tag = str(raw_tag).strip()
        if not tag:
            continue

        key = tag.casefold()
        if key in seen:
            continue

        seen.add(key)
        normalized.append(tag)

    return normalized


def get_or_create_tags(db: Session, tags: Optional[Iterable[str]]) -> List[TagModel]:
    tag_names = normalize_tags(tags)
    if not tag_names:
        return []

    existing_tags = db.query(TagModel).filter(TagModel.name.in_(tag_names)).all()
    tag_by_name = {tag.name: tag for tag in existing_tags}
    linked_tags = list(existing_tags)

    for tag_name in tag_names:
        if tag_name in tag_by_name:
            continue

        tag_model = TagModel(id=str(uuid.uuid4()), name=tag_name)
        db.add(tag_model)
        linked_tags.append(tag_model)
        tag_by_name[tag_name] = tag_model

    return [tag_by_name[tag_name] for tag_name in tag_names]


def serialize_notebook(notebook: NotebookModel) -> dict:
    return {
        "id": notebook.id,
        "user_id": notebook.user_id,
        "name": notebook.name,
        "description": notebook.description or "",
        "instructions": notebook.instructions or "",
        "sort_order": notebook.sort_order,
        "created_at": notebook.created_at,
        "updated_at": notebook.updated_at,
    }


def serialize_entry(entry: NoteEntryModel) -> dict:
    now = int(time.time() * 1000)
    logs = [log for log in entry.review_logs if log.timestamp <= now]
    review_count = max(entry.review_count or 0, len(logs))
    wrong_count = sum(log.is_correct is False for log in logs)
    return {
        "id": entry.id,
        "user_id": entry.user_id,
        "notebook_id": entry.notebook_id,
        "title": entry.title,
        "question": entry.question or "",
        "wrong_answer": entry.wrong_answer or "",
        "correct_answer": entry.correct_answer or "",
        "subject": entry.subject or "",
        "source": entry.source or "",
        "tags": [tag.name for tag in entry.tags],
        "drawings": entry.drawings or {},
        "folder": entry.folder,
        "group_id": entry.group_id,
        "sub_question_order": entry.sub_question_order,
        "sort_order": entry.sort_order,
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
        "review_count": review_count,
        "wrong_count": wrong_count,
        "learning_tags": [f"复习{review_count}次", f"答错{wrong_count}次"],
        "consecutive_passes": entry.consecutive_passes,
        "mastery_level": entry.mastery_level,
        "ease_factor": entry.ease_factor,
        "interval": entry.interval,
        "last_review_date": entry.last_review_date,
        "next_review_date": entry.next_review_date,
    }


def serialize_question_group(group: QuestionGroupModel) -> dict:
    return {
        "id": group.id,
        "notebook_id": group.notebook_id,
        "title": group.title,
        "material": group.material or "",
        "drawings": group.drawings or {},
        "created_at": group.created_at,
        "updated_at": group.updated_at,
    }


ENTRY_METADATA = (
    'id', 'user_id', 'notebook_id', 'title', 'subject', 'source', 'folder',
    'group_id', 'sub_question_order', 'sort_order', 'created_at', 'updated_at',
    'review_count', 'consecutive_passes', 'mastery_level', 'ease_factor', 'interval',
    'last_review_date', 'next_review_date',
)


def get_entry_summaries(db: Session, notebook_id: str, *, user_id: str, q: str = '') -> dict:
    owned_notebook(db, notebook_id, user_id)
    # Content columns are excluded from SELECT; even image-heavy notebooks return small rows.
    query = db.query(NoteEntryModel).options(
        load_only(*(getattr(NoteEntryModel, name) for name in ENTRY_METADATA)),
        selectinload(NoteEntryModel.tags),
    ).filter(NoteEntryModel.notebook_id == notebook_id, NoteEntryModel.user_id == user_id)
    if q:
        group_matches = db.query(QuestionGroupModel.id).filter(
            QuestionGroupModel.notebook_id == notebook_id,
            QuestionGroupModel.material.contains(q, autoescape=True),
        )
        query = query.filter(or_(
            *(getattr(NoteEntryModel, field).contains(q, autoescape=True)
              for field in ('title', 'question', 'wrong_answer', 'correct_answer', 'subject', 'source')),
            NoteEntryModel.tags.any(TagModel.name.contains(q, autoescape=True)),
            NoteEntryModel.group_id.in_(group_matches),
        ))
    # A bounded substring supplies title fallbacks without transferring full HTML/images.
    rows = query.add_columns(func.substr(NoteEntryModel.question, 1, 240)).order_by(
        NoteEntryModel.sort_order, NoteEntryModel.id).all()
    counts = {entry_id: (total, wrong) for entry_id, total, wrong in db.query(
        ReviewLogModel.entry_id, func.count(ReviewLogModel.id),
        func.sum(case((ReviewLogModel.is_correct.is_(False), 1), else_=0)),
    ).join(NoteEntryModel).filter(
        NoteEntryModel.user_id == user_id, NoteEntryModel.notebook_id == notebook_id,
        ReviewLogModel.timestamp <= int(time.time() * 1000),
    ).group_by(ReviewLogModel.entry_id).all()}
    return {'items': [dict(
        {name: getattr(entry, name) for name in ENTRY_METADATA},
        review_count=max(entry.review_count or 0, counts.get(entry.id, (0, 0))[0]),
        wrong_count=counts.get(entry.id, (0, 0))[1],
        tags=[tag.name for tag in entry.tags], question_preview=preview or '',
    ) for entry, preview in rows]}


def get_group_summaries(db: Session, notebook_id: str, *, user_id: str) -> dict:
    owned_notebook(db, notebook_id, user_id)
    fields = ('id', 'notebook_id', 'title', 'created_at', 'updated_at')
    groups = db.query(QuestionGroupModel).options(
        load_only(*(getattr(QuestionGroupModel, name) for name in fields))
    ).filter(QuestionGroupModel.notebook_id == notebook_id).all()
    return {'items': [{name: getattr(group, name) for name in fields} for group in groups]}


def serialize_review_log(log: ReviewLogModel) -> Dict[str, Any]:
    note = log.review_note or ''
    # 保留数据库结构化审核依据，页面批注只返回可阅读的理由和点评。
    if note.startswith('{'):
        try:
            grading = json.loads(note)
            if isinstance(grading, dict) and grading.get('source') == 'agent_grading':
                note = '\n\n'.join(part for part in (
                    '解题理由：' + grading['explanation_text'] if grading.get('explanation_text') else '',
                    '智能判卷：\n' + grading.get('comment', '')) if part)
        except (ValueError, TypeError):
            pass
    return {
        "id": log.id,
        "entry_id": log.entry_id,
        "timestamp": log.timestamp,
        "quality": log.quality,
        "selected_choice": log.selected_choice or "",
        "correct_choice": log.correct_choice or "",
        "is_correct": log.is_correct,
        "session_id": log.session_id or "",
        "elapsed_ms": log.elapsed_ms or 0,
        "review_note": note,
        "answer_text": log.answer_text or "",
    }


def create_notebook(
    db: Session,
    name: str,
    description: str = "",
    instructions: str = "",
    notebook_id: Optional[str] = None,
    *, user_id: str,
) -> dict:
    if notebook_id:
        existing = db.query(NotebookModel).filter(NotebookModel.id == notebook_id).first()
        if existing:
            if existing.user_id != user_id:
                raise HTTPException(status_code=409, detail="该 ID 不可用")
            existing.name = name
            existing.description = description
            existing.instructions = instructions
            existing.updated_at = int(time.time() * 1000)
            db.commit()
            db.refresh(existing)
            return serialize_notebook(existing)

    notebook = NotebookModel(
        id=notebook_id or str(uuid.uuid4()),
        user_id=user_id,
        name=name,
        description=description,
        instructions=instructions,
    )
    db.add(notebook)
    db.commit()
    db.refresh(notebook)
    return serialize_notebook(notebook)


def get_all_notebooks(db: Session, *, user_id: str) -> dict:
    notebooks = db.query(NotebookModel).filter(NotebookModel.user_id == user_id).order_by(NotebookModel.sort_order.asc()).all()
    return {"items": [serialize_notebook(item) for item in notebooks]}


def get_notebook_by_id(db: Session, notebook_id: str, *, user_id: str) -> Optional[dict]:
    notebook = owned_notebook(db, notebook_id, user_id)
    return serialize_notebook(notebook) if notebook else None


def update_notebook(db: Session, notebook_id: str, update_fields: Dict[str, Any], *, user_id: str) -> Optional[Dict[str, Any]]:
    notebook = owned_notebook(db, notebook_id, user_id)
    if not notebook:
        return None

    for key, value in update_fields.items():
        if key in {"name", "description", "instructions", "sort_order"}:
            setattr(notebook, key, value)

    notebook.updated_at = int(time.time() * 1000)
    db.commit()
    db.refresh(notebook)
    return serialize_notebook(notebook)


def delete_notebook(db: Session, notebook_id: str, *, user_id: str) -> bool:
    notebook = owned_notebook(db, notebook_id, user_id)
    if notebook:
        db.delete(notebook)
        db.commit()
        return True
    return False


def create_entry(
    db: Session,
    notebook_id: str,
    title: str,
    question: str,
    correct_answer: str = "",
    wrong_answer: str = "",
    subject: str = "",
    source: str = "",
    tags: Optional[List[str]] = None,
    drawings: Optional[Dict[str, Any]] = None,
    sort_order: int = 0,
    folder: Optional[str] = None,
    group_id: Optional[str] = None,
    sub_question_order: Optional[int] = None,
    entry_id: Optional[str] = None,
    review_count: Optional[int] = None,
    *, user_id: str,
) -> dict:
    owned_notebook(db, notebook_id, user_id)
    check_group(db, group_id, notebook_id, user_id)

    if entry_id:
        existing = db.query(NoteEntryModel).filter(NoteEntryModel.id == entry_id).first()
        if existing:
            if existing.user_id != user_id:
                raise HTTPException(status_code=409, detail="该 ID 不可用")
            existing.notebook_id = notebook_id
            existing.title = title
            existing.question = question
            existing.correct_answer = correct_answer
            existing.wrong_answer = wrong_answer
            existing.subject = subject
            existing.source = source
            existing.tags = get_or_create_tags(db, tags)
            existing.drawings = drawings
            existing.sort_order = sort_order
            existing.folder = folder
            existing.group_id = group_id
            existing.sub_question_order = sub_question_order
            if review_count is not None:
                existing.review_count = review_count
            existing.updated_at = int(time.time() * 1000)
            db.commit()
            db.refresh(existing)
            return serialize_entry(existing)

    entry = NoteEntryModel(
        id=entry_id or f"cuoti_{int(time.time())}_{uuid.uuid4().hex[:6]}",
        user_id=user_id,
        notebook_id=notebook_id,
        title=title,
        question=question,
        correct_answer=correct_answer,
        wrong_answer=wrong_answer,
        subject=subject,
        source=source,
        tags=get_or_create_tags(db, tags),
        drawings=drawings,
        sort_order=sort_order,
        folder=folder,
        group_id=group_id,
        sub_question_order=sub_question_order,
        review_count=review_count or 0,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return serialize_entry(entry)


def update_entry(db: Session, entry_id: str, update_fields: Dict[str, Any], *, user_id: str) -> Optional[Dict[str, Any]]:
    entry = owned_entry(db, entry_id, user_id)
    if not entry:
        return None

    if "group_id" in update_fields:
        check_group(db, update_fields["group_id"], entry.notebook_id, user_id)

    if "tags" in update_fields:
        entry.tags = get_or_create_tags(db, update_fields.pop("tags"))

    for key, value in update_fields.items():
        if key == 'review_count' and value is not None:
            entry.review_count = value
        if key in {"title", "question", "correct_answer", "wrong_answer", "subject", "source", "drawings", "sort_order", "folder", "group_id", "sub_question_order", "mastery_level", "next_review_date"}:
            setattr(entry, key, value)

    entry.updated_at = int(time.time() * 1000)
    db.commit()
    db.refresh(entry)
    return serialize_entry(entry)


def delete_entry(db: Session, entry_id: str, *, user_id: str) -> bool:
    entry = owned_entry(db, entry_id, user_id)
    if entry:
        db.delete(entry)
        db.commit()
        return True
    return False


def get_all_question_groups(db: Session, notebook_id: str, *, user_id: str) -> dict:
    owned_notebook(db, notebook_id, user_id)
    groups = (
        db.query(QuestionGroupModel)
        .filter(QuestionGroupModel.notebook_id == notebook_id)
        .order_by(QuestionGroupModel.created_at.asc())
        .all()
    )
    return {"items": [serialize_question_group(group) for group in groups]}


def get_question_group(db: Session, group_id: str, *, user_id: str) -> Optional[dict]:
    group = owned_group(db, group_id, user_id)
    return serialize_question_group(group) if group else None


def create_question_group(
    db: Session,
    notebook_id: str,
    title: str = "",
    material: str = "",
    drawings: Optional[Dict[str, Any]] = None,
    group_id: Optional[str] = None,
    *, user_id: str,
) -> dict:
    owned_notebook(db, notebook_id, user_id)
    if group_id:
        existing = db.query(QuestionGroupModel).filter(QuestionGroupModel.id == group_id).first()
        if existing:
            owned_group(db, existing.id, user_id)
            if existing.notebook_id != notebook_id:
                raise HTTPException(status_code=400, detail="已有题组不能移动到其他笔记本")
            existing.title = title
            existing.material = material
            existing.drawings = drawings
            existing.updated_at = int(time.time() * 1000)
            db.commit()
            db.refresh(existing)
            return serialize_question_group(existing)

    group = QuestionGroupModel(
        id=group_id or str(uuid.uuid4()),
        notebook_id=notebook_id,
        title=title,
        material=material,
        drawings=drawings,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return serialize_question_group(group)


def update_question_group(db: Session, group_id: str, update_fields: Dict[str, Any], *, user_id: str) -> Optional[dict]:
    group = owned_group(db, group_id, user_id)
    if not group:
        return None
    for key, value in update_fields.items():
        if key in {"title", "material", "drawings"}:
            setattr(group, key, value)
    group.updated_at = int(time.time() * 1000)
    db.commit()
    db.refresh(group)
    return serialize_question_group(group)


def delete_question_group(db: Session, group_id: str, *, user_id: str) -> bool:
    group = owned_group(db, group_id, user_id)
    if not group:
        return False
    db.query(NoteEntryModel).filter(
        NoteEntryModel.group_id == group_id, NoteEntryModel.user_id == user_id
    ).update({"group_id": None, "sub_question_order": None}, synchronize_session=False)
    db.delete(group)
    db.commit()
    return True


def search_and_filter_entries(
    db: Session,
    notebook_id: str,
    subject: Optional[str] = None,
    tag: Optional[str] = None,
    search_query: Optional[str] = None,
    sort_key: str = "created_at",
    sort_dir: str = "desc",
    *, user_id: str,
) -> Dict[str, Any]:
    owned_notebook(db, notebook_id, user_id)
    query = db.query(NoteEntryModel).options(
        selectinload(NoteEntryModel.tags), selectinload(NoteEntryModel.review_logs),
    ).filter(
        NoteEntryModel.notebook_id == notebook_id, NoteEntryModel.user_id == user_id
    )

    if subject and subject != "__all__":
        query = query.filter(NoteEntryModel.subject == subject)

    if tag:
        normalized_tag = str(tag).strip()
        if normalized_tag:
            query = query.join(NoteEntryModel.tags).filter(TagModel.name == normalized_tag)

    if search_query:
        query = query.filter(
            NoteEntryModel.title.contains(search_query) | NoteEntryModel.question.contains(search_query)
        )

    sort_column = getattr(NoteEntryModel, sort_key, NoteEntryModel.created_at)
    if sort_dir.lower() == "desc":
        query = query.order_by(sort_column.desc())
    else:
        query = query.order_by(sort_column.asc())

    entries = query.distinct().all()
    return {"items": [serialize_entry(item) for item in entries]}


def add_review_log(
    db: Session,
    entry_id: str,
    quality: str,
    is_correct: Optional[bool] = None,
    elapsed_ms: int = 0,
    log_id: Optional[str] = None,
    timestamp: Optional[int] = None,
    *, user_id: str, answer_text: Optional[str] = None,
) -> Dict[str, Any]:
    owned_entry(db, entry_id, user_id)
    if log_id:
        existing = db.query(ReviewLogModel).filter(ReviewLogModel.id == log_id).first()
        if existing:
            if existing.entry_id != entry_id:
                raise HTTPException(status_code=409, detail="该复习记录 ID 不可用")
            return serialize_review_log(existing)

    log = ReviewLogModel(
        id=log_id or str(uuid.uuid4()),
        entry_id=entry_id,
        timestamp=timestamp or int(time.time() * 1000),
        quality=quality,
        is_correct=is_correct,
        elapsed_ms=elapsed_ms,
        answer_text=answer_text.strip() if answer_text and answer_text.strip() else None,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return serialize_review_log(log)
