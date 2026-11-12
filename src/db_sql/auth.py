"""JWT authentication helpers, based on FastAPI's full-stack template flow."""

import os
import time
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash
from sqlalchemy.orm import Session

from src.db_sql.database import get_db
from src.db_sql.models import UserModel


ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080"))
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-this-local-development-secret")
password_hash = PasswordHash.recommended()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login/access-token")


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password, hashed_password)


def create_access_token(user_id: str) -> str:
    expires_at = datetime.now(UTC) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": user_id, "exp": expires_at, "iat": time.time(), "jti": str(uuid.uuid4())},
        SECRET_KEY, algorithm=ALGORITHM,
    )


def authenticate_user(db: Session, email: str, password: str) -> UserModel | None:
    user = db.query(UserModel).filter(UserModel.email == email.lower()).first()
    if not user or not verify_password(password, user.hashed_password):
        return None
    return user


def create_user(db: Session, email: str, password: str, full_name: str | None = None) -> UserModel:
    user = UserModel(
        id=str(uuid.uuid4()),
        email=email.lower(),
        full_name=full_name.strip() if full_name else None,
        hashed_password=hash_password(password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> UserModel:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="登录已过期或无效，请重新登录",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not isinstance(user_id, str):
            raise credentials_error
    except InvalidTokenError:
        raise credentials_error

    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user or not user.is_active:
        raise credentials_error
    issued_at = payload.get("iat", 0)
    if not isinstance(issued_at, (int, float)) or issued_at < user.password_changed_at:
        raise credentials_error
    return user
