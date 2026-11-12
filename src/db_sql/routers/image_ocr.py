"""Forward an owned notebook's image to the existing MinerU service."""
import os
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from src.db_sql import crud
from src.db_sql.auth import get_current_user
from src.db_sql.database import get_db
from src.db_sql.models import UserModel

router = APIRouter(prefix='/api/image-ocr', tags=['图片转文字'])
MAX_IMAGE_BYTES = 20 * 1024 * 1024


class OcrResult(BaseModel):
    text: str = Field(max_length=200_000)
    engine: Literal['mineru-ocr']


@router.post('', response_model=OcrResult)
async def recognize(notebook_id: str = Form(...), file: UploadFile = File(...),
                    user: UserModel = Depends(get_current_user), db: Session = Depends(get_db),
                    authorization: str = Header(default='')):
    crud.owned_notebook(db, notebook_id, user.id)
    db.rollback()  # Release the read transaction before waiting for OCR.
    data = await file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, '图片不能超过 20 MB')
    if not data:
        raise HTTPException(422, '图片为空，请重新选择')
    url = os.getenv('RAG_AGENT_URL', 'http://127.0.0.1:8001').rstrip('/')
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=10), trust_env=False) as client:
            response = await client.post(url + '/image-ocr',
                files={'file': ('image', data, file.content_type or 'application/octet-stream')},
                headers={'Authorization': authorization})
        if response.status_code != 200:
            detail = response.json().get('detail')
            status = response.status_code if response.status_code in {401, 413, 422, 503} else 503
            raise HTTPException(status, detail if isinstance(detail, str) else '文字识别未完成，请重试')
        if len(response.content) > 2 * 1024 * 1024:
            raise ValueError('Oversized OCR response')
        return OcrResult.model_validate(response.json())
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, ValidationError) as exc:
        raise HTTPException(503, '文字识别暂时不可用，请重试或仅插入图片') from exc
