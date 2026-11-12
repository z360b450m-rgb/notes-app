from uuid import UUID
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from src.db_sql.auth import get_current_user
from src.db_sql.database import get_db
from src.db_sql.models import NotebookIndexModel, NotebookModel, UserModel
from src.db_sql.notebook_index import prepare_index, run_index, serialize_index

router = APIRouter(prefix='/api/knowledge', tags=['知识库入库'])


class NotebookIngest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kb_id: UUID
    notebook_id: str = Field(min_length=1, max_length=64)
    remove: bool = False


@router.get('/notebooks')
def sources(db: Session = Depends(get_db), user: UserModel = Depends(get_current_user)):
    books = {book.id: {'id': book.id, 'name': book.name, 'deleted': False}
             for book in db.query(NotebookModel).filter_by(user_id=user.id).all()}
    indexes = db.query(NotebookIndexModel).filter_by(user_id=user.id).all()
    for row in indexes:
        books.setdefault(row.notebook_id, {'id': row.notebook_id, 'name': row.notebook_name, 'deleted': True})
    return {'items': list(books.values()), 'indexes': [serialize_index(row) for row in indexes]}


@router.post('/ingest', status_code=202)
def ingest(payload: NotebookIngest, background_tasks: BackgroundTasks,
           db: Session = Depends(get_db), user: UserModel = Depends(get_current_user)):
    row = prepare_index(db, user.id, str(payload.kb_id), payload.notebook_id, payload.remove)
    background_tasks.add_task(run_index, row.id, row.task_id)
    return serialize_index(row)


@router.get('/ingest/{index_id}')
def status(index_id: str, db: Session = Depends(get_db), user: UserModel = Depends(get_current_user)):
    row = db.query(NotebookIndexModel).filter_by(id=index_id, user_id=user.id).first()
    if not row:
        raise HTTPException(404, '入库记录未找到')
    return serialize_index(row)
