from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.db_sql.auth import get_current_user
from src.db_sql.database import get_db
from src.db_sql.models import UserModel
from src.db_sql.schemas import NotebookCreate, NotebookUpdate
from src.db_sql import crud
from src.db_sql.notebook_overview import OverviewRequest, notebook_overview


router = APIRouter(prefix="/api/notebooks", tags=["笔记本"])


@router.get("")
def list_notebooks(
    db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)
):
    return crud.get_all_notebooks(db, user_id=current_user.id)


@router.post("/overview")
def get_notebook_overview(
    payload: OverviewRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    return notebook_overview(db, current_user.id, payload)


@router.get("/{notebook_id}")
def get_notebook_by_id(
    notebook_id: str,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    notebook = crud.get_notebook_by_id(db, notebook_id, user_id=current_user.id)
    if not notebook:
        raise HTTPException(status_code=404, detail="笔记本未找到")
    return notebook


@router.post("", status_code=status.HTTP_201_CREATED)
def create_notebook(
    payload: NotebookCreate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    return crud.create_notebook(
        db,
        user_id=current_user.id,
        notebook_id=payload.id,
        name=payload.name,
        description=payload.description or "",
        instructions=payload.instructions or "",
    )


@router.patch("/{notebook_id}")
def update_notebook(
    notebook_id: str,
    payload: NotebookUpdate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="没有提供需要更新的字段")
    updated_notebook = crud.update_notebook(db, notebook_id, update_data, user_id=current_user.id)
    if not updated_notebook:
        raise HTTPException(status_code=404, detail="笔记本未找到")
    return updated_notebook


@router.delete("/{notebook_id}")
def delete_notebook(
    notebook_id: str,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    if not crud.delete_notebook(db, notebook_id, user_id=current_user.id):
        raise HTTPException(status_code=404, detail="笔记本未找到")
    return {"message": "笔记本及其所有条目已删除", "id": notebook_id}
