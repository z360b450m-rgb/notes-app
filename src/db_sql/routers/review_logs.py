from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.db_sql import crud
from src.db_sql.auth import get_current_user
from src.db_sql.database import get_db
from src.db_sql.models import UserModel
from src.db_sql.schemas import ReviewLogCreate


router = APIRouter(prefix="/api/entries", tags=["复习"])


@router.post("/{entry_id}/review")
def add_review_log(
    entry_id: str,
    payload: ReviewLogCreate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    return crud.add_review_log(
        db,
        user_id=current_user.id,
        entry_id=entry_id,
        log_id=payload.id,
        timestamp=payload.timestamp,
        quality=payload.quality,
        is_correct=payload.is_correct,
        elapsed_ms=payload.elapsed_ms or 0,
        answer_text=payload.answer_text,
    )
