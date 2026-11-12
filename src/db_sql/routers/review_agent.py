"""Authenticated adapter for the independently running Shopkeeper query service."""

import hashlib
import logging
import os
import json
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from src.db_sql.auth import get_current_user
from src.db_sql.models import UserModel

router = APIRouter(prefix="/api/review-agent", tags=["复习助手"])
logger = logging.getLogger(__name__)


def agent_session_id(user_id: str, session_id: UUID) -> str:
    owner = hashlib.sha256(user_id.encode("utf-8")).hexdigest()
    return f"notes-{owner}-{session_id}"


@router.post('/history/{session_id}/title')
async def generate_agent_title(session_id: UUID, user: UserModel = Depends(get_current_user),
                               authorization: str = Header(default='')):
    base_url = os.getenv('RAG_AGENT_URL', 'http://127.0.0.1:8001').rstrip('/')
    try:
        async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
            response = await client.post(
                f'{base_url}/chat-title',
                json={'session_id': agent_session_id(user.id, session_id)},
                headers={'Authorization': authorization} if authorization else {},
            )
        response.raise_for_status()
        result = response.json()
        title = result.get('title') if isinstance(result, dict) else None
        if (not isinstance(title, str) or not title.strip() or len(title) > 32
                or '\n' in title or '\r' in title):
            raise ValueError('Invalid title')
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning('RAG title generation failed: %s', type(exc).__name__)
        raise HTTPException(503, '暂时无法生成标题') from exc
    return {'title': title.strip()}


@router.delete("/history/{session_id}")
async def delete_agent_history(session_id: UUID, user: UserModel = Depends(get_current_user),
                               authorization: str = Header(default='')):
    base_url = os.getenv("RAG_AGENT_URL", "http://127.0.0.1:8001").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
            response = await client.delete(
                f"{base_url}/history/{agent_session_id(user.id, session_id)}",
                headers={'Authorization': authorization} if authorization else {},
            )
        response.raise_for_status()
        result = response.json()
        count = result.get('deleted_count') if isinstance(result, dict) else None
        if type(count) is not int or count < 0:
            raise ValueError('Invalid history deletion response')
    except httpx.TimeoutException as exc:
        raise HTTPException(504, "删除聊天记录超时，记录已保留，请重试") from exc
    except httpx.ConnectError as exc:
        raise HTTPException(503, "智能体服务未启动，聊天记录已保留，请启动服务后重试") from exc
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("RAG history deletion failed: %s", type(exc).__name__)
        raise HTTPException(502, "智能体聊天记录删除失败，记录已保留，请稍后重试") from exc
    return {"session_id": str(session_id), "deleted_count": count}


class ReviewQuery(BaseModel):
    model_config = ConfigDict(extra='forbid')
    query: str = Field(min_length=1, max_length=2000)
    session_id: UUID
    is_stream: bool = True
    kb_ids: list[UUID] = Field(default_factory=list, max_length=20)

    @field_validator("query")
    @classmethod
    def nonempty_query(cls, value):
        if not value.strip():
            raise ValueError("问题不能为空")
        return value.strip()


@router.post("/query")
async def query_agent(payload: ReviewQuery, user: UserModel = Depends(get_current_user),
                      authorization: str = Header(default='')):
    return await forward_query(payload, user.id, authorization)


async def forward_query(payload: ReviewQuery, user_id: str, authorization: str, *, entry_request=None):
    # A browser session UUID cannot be used to access another account's model history.
    session_id = agent_session_id(user_id, payload.session_id)
    base_url = os.getenv("RAG_AGENT_URL", "http://127.0.0.1:8001").rstrip("/")
    timeout = float(os.getenv("RAG_AGENT_TIMEOUT_SECONDS", "180"))
    body = {
        "query": payload.query,
        "session_id": session_id,
        "is_stream": payload.is_stream,
    }
    if payload.kb_ids:
        body['kb_ids'] = [str(value) for value in payload.kb_ids]
    if entry_request is not None:
        body['entry_request'] = entry_request
    try:
        async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
            response = await client.post(f"{base_url}/query", json=body,
                                         headers={'Authorization': authorization} if authorization else {})
        response.raise_for_status()
        result = response.json()
        if payload.is_stream:
            if not isinstance(result, dict) or not isinstance(result.get('task_id'), str) or not result['task_id']:
                raise ValueError('Invalid stream task')
        elif not isinstance(result, dict) or not isinstance(result.get("answer"), str) or not result["answer"].strip():
            raise ValueError("Invalid agent answer")
    except httpx.TimeoutException as exc:
        raise HTTPException(504, "助手响应超时，请稍后重试") from exc
    except httpx.ConnectError as exc:
        raise HTTPException(503, "RAG 服务未启动，请启动 shopkeeper_brain 查询服务（8001 端口）") from exc
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("RAG query failed: %s", type(exc).__name__)
        raise HTTPException(502, "RAG 服务处理失败，请检查查询服务日志和模型配置后重试") from exc
    if payload.is_stream:
        return StreamingResponse(
            forward_agent_stream(base_url, result['task_id'], timeout),
            media_type='text/event-stream',
            headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
        )
    answer = {"session_id": str(payload.session_id), "answer": result["answer"]}
    if result.get('clarification_choices'):
        answer['clarification_choices'] = result['clarification_choices']
    return answer


async def forward_agent_stream(base_url: str, task_id: str, timeout: float):
    """逐块转发上游SSE，不等待完整答案。"""
    try:
        async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
            async with client.stream('GET', f'{base_url}/stream/{task_id}') as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    yield chunk
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning('RAG stream failed: %s', type(exc).__name__)
        payload = json.dumps({'error': '助手连接中断，请稍后重试'}, ensure_ascii=False)
        yield f'event: error\ndata: {payload}\n\n'.encode('utf-8')
