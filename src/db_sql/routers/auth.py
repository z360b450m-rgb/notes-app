import time

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from src.db_sql.auth import authenticate_user, create_access_token, create_user, get_current_user, hash_password, verify_password
from src.db_sql.database import get_db
from src.db_sql.models import UserModel
from src.db_sql.email_verification import issue_code, verify_code
from src.db_sql.schemas import EmailCodeRequest, PasswordChange, PasswordReset, Token, UserPublic, UserRegister


router = APIRouter(prefix="/api", tags=["认证"])


def serialize_user(user: UserModel) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "is_active": user.is_active,
        "created_at": user.created_at,
    }


@router.post("/users/signup", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
def signup(payload: UserRegister, db: Session = Depends(get_db)):
    existing = db.query(UserModel).filter(UserModel.email == payload.email.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail="该邮箱已经注册")
    verify_code(db, payload.email, "signup", payload.code)
    try:
        return serialize_user(create_user(db, payload.email, payload.password, payload.full_name))
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "该邮箱已经注册") from None


@router.post("/auth/email-code")
def send_email_code(payload: EmailCodeRequest, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter_by(email=payload.email).first()
    eligible = not user if payload.purpose == "signup" else bool(user and user.is_active)
    return issue_code(db, payload.email, payload.purpose, deliver=eligible)


@router.post("/auth/reset-password")
def reset_password(payload: PasswordReset, db: Session = Depends(get_db)):
    verify_code(db, payload.email, "reset_password", payload.code)
    user = db.query(UserModel).filter_by(email=payload.email).with_for_update().first()
    if not user or not user.is_active:
        raise HTTPException(400, "验证码无效或已过期，请重新获取")
    if verify_password(payload.new_password, user.hashed_password):
        raise HTTPException(400, "新密码不能与原密码相同")
    user.hashed_password = hash_password(payload.new_password)
    user.password_changed_at = time.time()
    db.commit()
    return {"message": "密码已重置，请使用新密码登录"}


@router.post("/users/me/password")
def change_password(
    payload: PasswordChange,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(UserModel).filter_by(id=current_user.id).populate_existing().with_for_update().one()
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(400, "当前密码不正确")
    if payload.current_password == payload.new_password:
        raise HTTPException(400, "新密码不能与原密码相同")
    user.hashed_password = hash_password(payload.new_password)
    user.password_changed_at = time.time()
    db.commit()
    return {"message": "密码已修改，请重新登录"}


@router.post("/login/access-token", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=400, detail="邮箱或密码不正确")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="当前账号已被禁用")
    return {"access_token": create_access_token(user.id), "token_type": "bearer"}


@router.get("/users/me", response_model=UserPublic)
def read_current_user(current_user: UserModel = Depends(get_current_user)):
    return serialize_user(current_user)
