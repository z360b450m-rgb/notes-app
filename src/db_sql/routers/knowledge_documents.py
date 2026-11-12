"""Proxy library management/import to the persistent RAG document pipeline."""
import os
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile, Query, Path
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from src.db_sql.auth import get_current_user
from src.db_sql.models import UserModel, NotebookIndexModel
from src.db_sql.database import get_db
from src.db_sql.notebook_index import PROCESS_ID, now_ms

router = APIRouter(prefix='/api/knowledge/documents', tags=['知识库资料'])


@router.get('/{ident}/entries')
async def list_entries(ident: UUID, q: str = Query(default='', max_length=200),
                      offset: int = Query(default=0, ge=0), limit: int = Query(default=20, ge=1, le=50),
                      user: UserModel = Depends(get_current_user), authorization: str = Header(default=''),
                      db: Session = Depends(get_db)):
    result = await forward('GET', f'/{ident}/entries', authorization,
                           params={'q': q, 'offset': offset, 'limit': limit})
    names = {row.notebook_id: row.notebook_name for row in db.query(NotebookIndexModel)
             .filter_by(user_id=user.id, kb_id=str(ident)).all()}
    for item in result['items']:
        item['notebook_name'] = names.get(item['notebook_id'], '来源错题本')
    return result


@router.get('/{ident}/entries/{notebook_id}/{entry_id}')
async def entry_detail(ident: UUID, notebook_id: str = Path(min_length=1, max_length=64),
                       entry_id: str = Path(min_length=1, max_length=64),
                       user: UserModel = Depends(get_current_user), authorization: str = Header(default='')):
    from urllib.parse import quote
    return await forward('GET', f'/{ident}/entries/{quote(notebook_id, safe="")}/{quote(entry_id, safe="")}', authorization)


@router.delete('/{ident}/entries/{notebook_id}/{entry_id}')
async def remove_entry(ident: UUID, notebook_id: str = Path(min_length=1, max_length=64),
                       entry_id: str = Path(min_length=1, max_length=64),
                       user: UserModel = Depends(get_current_user), authorization: str = Header(default=''),
                       db: Session = Depends(get_db)):
    from urllib.parse import quote
    row = db.query(NotebookIndexModel).filter_by(user_id=user.id, kb_id=str(ident),
        notebook_id=notebook_id).with_for_update().first()
    if (row and row.status == 'running' and row.snapshot.get('worker_id') == PROCESS_ID
            and now_ms() - row.updated_at < 2 * 3600000):
        raise HTTPException(409, '该错题本正在入库，请等待完成后移除')
    result = await forward('DELETE', f'/{ident}/entries/{quote(notebook_id, safe="")}/{quote(entry_id, safe="")}', authorization)
    if result.get('removed') is not True:
        raise HTTPException(502, '未能确认错题已移除，请重试')
    if row:
        row.hashes = {key: value for key, value in row.hashes.items() if key != entry_id}
        row.updated_at = now_ms()
        db.commit()
    return result


class LibraryMetadata(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default='', max_length=2000)


class LibraryUpdate(LibraryMetadata):
    archived: bool = False


async def forward(method, path, authorization, **kwargs):
    base = os.getenv('RAG_AGENT_URL', 'http://127.0.0.1:8001').rstrip('/')
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=10), trust_env=False) as client:
            response = await client.request(method, base + '/knowledge/libraries' + path,
                headers={'Authorization': authorization}, **kwargs)
        if response.status_code >= 400:
            detail = response.json().get('detail', '知识库服务处理失败')
            raise HTTPException(response.status_code if response.status_code in (401, 404, 409, 413, 422, 503) else 502,
                                detail if isinstance(detail, str) else '知识库请求无效')
        return response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(503, '知识库服务暂时不可用，请确认 RAG 服务已启动') from exc


@router.get('')
async def libraries(user: UserModel = Depends(get_current_user), authorization: str = Header(default='')):
    return await forward('GET', '', authorization)


@router.post('')
async def create(payload: LibraryMetadata, user: UserModel = Depends(get_current_user),
                 authorization: str = Header(default='')):
    return await forward('POST', '', authorization, json=payload.model_dump())


@router.patch('/{ident}')
async def update(ident: UUID, payload: LibraryUpdate, user: UserModel = Depends(get_current_user),
                 authorization: str = Header(default='')):
    return await forward('PATCH', '/' + str(ident), authorization, json=payload.model_dump())


@router.post('/import', status_code=202)
@router.post('/{ident}/import', status_code=202)
async def import_file(file: UploadFile = File(...), user: UserModel = Depends(get_current_user),
                      authorization: str = Header(default=''), ident: UUID = None):
    size = 0
    while chunk := await file.read(1024 * 1024):
        size += len(chunk)
        if size > 100 * 1024 * 1024:
            raise HTTPException(413, '文件不能超过 100 MB')
    await file.seek(0)
    return await forward('POST', ('/' + str(ident) if ident is not None else '') + '/import', authorization,
        files={'file': (file.filename or '', file.file, file.content_type or 'application/octet-stream')})


@router.post('/import/reserve', status_code=201)
async def reserve(payload: LibraryMetadata, user: UserModel = Depends(get_current_user),
                  authorization: str = Header(default='')):
    return await forward('POST', '/import/reserve', authorization, json=payload.model_dump())


@router.post('/{ident}/cancel', status_code=202)
async def cancel(ident: UUID, user: UserModel = Depends(get_current_user), authorization: str = Header(default='')):
    return await forward('POST', '/' + str(ident) + '/cancel', authorization)


@router.delete('/{ident}', status_code=202)
async def delete(ident: UUID, user: UserModel = Depends(get_current_user), authorization: str = Header(default=''),
                 db: Session = Depends(get_db)):
    result = await forward('DELETE', '/' + str(ident), authorization)
    # Stop the explicit index runner by removing its manifest, without deleting source notebooks/questions.
    db.query(NotebookIndexModel).filter_by(user_id=user.id, kb_id=str(ident)).delete(synchronize_session=False)
    db.commit()
    return result
