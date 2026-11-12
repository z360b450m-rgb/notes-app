from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.db_sql import crud
from src.db_sql.auth import get_current_user
from src.db_sql.database import get_db
from src.db_sql.models import UserModel
from src.db_sql.schemas import QuestionGroupCreate, QuestionGroupUpdate


router = APIRouter(prefix="/api/question-groups", tags=["同题组"])


@router.get("")
def list_question_groups(
    notebook_id: str,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    return crud.get_all_question_groups(db, notebook_id, user_id=current_user.id)


@router.get('/summaries')
def group_summaries(notebook_id: str, db: Session = Depends(get_db),
                    current_user: UserModel = Depends(get_current_user)):
    return crud.get_group_summaries(db, notebook_id, user_id=current_user.id)


@router.get('/{group_id}')
def get_group(group_id: str, notebook_id: str, db: Session = Depends(get_db),
              current_user: UserModel = Depends(get_current_user)):
    group = crud.owned_group(db, group_id, current_user.id)
    if group.notebook_id != notebook_id:
        raise HTTPException(status_code=404, detail='题组未找到')
    return crud.serialize_question_group(group)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_question_group(
    payload: QuestionGroupCreate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    return crud.create_question_group(
        db,
        user_id=current_user.id,
        notebook_id=payload.notebook_id,
        title=payload.title,
        material=payload.material,
        drawings=payload.drawings,
        group_id=payload.id,
    )


@router.patch("/{group_id}")
def update_question_group(
    group_id: str,
    payload: QuestionGroupUpdate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="没有提供需要更新的字段")
    group = crud.update_question_group(db, group_id, update_data, user_id=current_user.id)
    if not group:
        raise HTTPException(status_code=404, detail="题组未找到")
    return group


@router.delete("/{group_id}")
def delete_question_group(
    group_id: str,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    if not crud.delete_question_group(db, group_id, user_id=current_user.id):
        raise HTTPException(status_code=404, detail="题组未找到")
    return {"message": "题组已删除", "id": group_id}
