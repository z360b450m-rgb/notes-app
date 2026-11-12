from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.db_sql import crud
from src.db_sql.auth import get_current_user
from src.db_sql.database import get_db
from src.db_sql.models import UserModel
from src.db_sql.schemas import EntryCreate, EntryUpdate


router = APIRouter(prefix="/api/entries", tags=["错题条目"])


@router.get("/search")
def search_entries(
    notebook_id: str,
    subject: Optional[str] = None,
    tag: Optional[str] = None,
    q: Optional[str] = None,
    sort_key: str = "created_at",
    sort_dir: str = "desc",
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    return crud.search_and_filter_entries(
        db,
        user_id=current_user.id,
        notebook_id=notebook_id,
        subject=subject,
        tag=tag,
        search_query=q,
        sort_key=sort_key,
        sort_dir=sort_dir,
    )


@router.get('/summaries')
def entry_summaries(notebook_id: str, q: str = '', db: Session = Depends(get_db),
                    current_user: UserModel = Depends(get_current_user)):
    return crud.get_entry_summaries(db, notebook_id, user_id=current_user.id, q=q)


@router.get('/{entry_id}')
def get_entry(entry_id: str, notebook_id: str, db: Session = Depends(get_db),
              current_user: UserModel = Depends(get_current_user)):
    entry = crud.owned_entry(db, entry_id, current_user.id)
    if entry.notebook_id != notebook_id:
        raise HTTPException(status_code=404, detail='错题未找到')
    return crud.serialize_entry(entry)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_entry(
    payload: EntryCreate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    return crud.create_entry(
        db,
        user_id=current_user.id,
        entry_id=payload.id,
        notebook_id=payload.notebook_id,
        title=payload.title,
        question=payload.question,
        correct_answer=payload.correct_answer or "",
        wrong_answer=payload.wrong_answer or "",
        subject=payload.subject or "",
        source=payload.source or "",
        tags=payload.tags,
        drawings=payload.drawings,
        sort_order=payload.sort_order or 0,
        folder=payload.folder,
        group_id=payload.group_id,
        sub_question_order=payload.sub_question_order,
        review_count=payload.review_count,
    )


@router.patch("/{entry_id}")
def update_entry(
    entry_id: str,
    payload: EntryUpdate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="没有提供需要更新的字段")
    updated_entry = crud.update_entry(db, entry_id, update_data, user_id=current_user.id)
    if not updated_entry:
        raise HTTPException(status_code=404, detail="错题未找到")
    return updated_entry


@router.delete("/{entry_id}")
def delete_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    if not crud.delete_entry(db, entry_id, user_id=current_user.id):
        raise HTTPException(status_code=404, detail="错题未找到")
    return {"message": "错题已成功删除", "id": entry_id}
