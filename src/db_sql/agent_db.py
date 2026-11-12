from collections.abc import Callable
from contextlib import contextmanager
from contextvars import ContextVar
from typing import TypeVar

from sqlalchemy.orm import Session

from src.db_sql.database import SessionLocal

T = TypeVar("T")
agent_user_id: ContextVar[str | None] = ContextVar("agent_user_id", default=None)


@contextmanager
def agent_user_scope(user_id: str):
    """Bind an authenticated identity around an Agent invocation on the server."""
    if not user_id:
        raise ValueError("An authenticated user is required")
    token = agent_user_id.set(user_id)
    try:
        yield
    finally:
        agent_user_id.reset(token)


def run_with_db(callback: Callable[[Session], T]) -> T:
    db = SessionLocal()
    try:
        return callback(db)
    finally:
        db.close()
