from typing import List, Literal, Optional
from pydantic import BaseModel, Field, field_validator
# ===========================================================================
# 1. 笔记本
# ===========================================================================
class NotebookCreate(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = ""
    instructions: Optional[str] = ""
class NotebookUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    instructions: Optional[str] = None
    sort_order: Optional[int] = None
# ===========================================================================
# 2. 错题条目
# ===========================================================================
class EntryCreate(BaseModel):
    id: Optional[str] = None
    notebook_id: str
    title: str
    question: str
    correct_answer: Optional[str] = ""
    wrong_answer: Optional[str] = ""
    subject: Optional[str] = ""
    source: Optional[str] = ""
    tags: List[str] = Field(default_factory=list)
    drawings: Optional[dict] = None
    sort_order: Optional[int] = 0
    folder: Optional[str] = None
    group_id: Optional[str] = None
    sub_question_order: Optional[int] = None
    review_count: Optional[int] = Field(default=None, ge=0)
class EntryUpdate(BaseModel):
    title: Optional[str] = None
    question: Optional[str] = None
    correct_answer: Optional[str] = None
    wrong_answer: Optional[str] = None
    subject: Optional[str] = None
    source: Optional[str] = None
    tags: Optional[List[str]] = None
    drawings: Optional[dict] = None
    sort_order: Optional[int] = None
    folder: Optional[str] = None
    group_id: Optional[str] = None
    sub_question_order: Optional[int] = None
    mastery_level: Optional[int] = None
    next_review_date: Optional[int] = None
    review_count: Optional[int] = Field(default=None, ge=0)
# ===========================================================================
# 3. 复习日志
# ===========================================================================
class ReviewLogCreate(BaseModel):
    id: Optional[str] = None
    timestamp: Optional[int] = None
    quality: str
    is_correct: Optional[bool] = None
    elapsed_ms: Optional[int] = 0
    answer_text: Optional[str] = Field(default=None, max_length=20000)


# ===========================================================================
# 4. 同题组共享材料
# ===========================================================================
class QuestionGroupCreate(BaseModel):
    id: Optional[str] = None
    notebook_id: str
    title: str = ""
    material: str = ""
    drawings: Optional[dict] = None


class QuestionGroupUpdate(BaseModel):
    title: Optional[str] = None
    material: Optional[str] = None
    drawings: Optional[dict] = None


# ===========================================================================
# 5. 用户认证
# ===========================================================================
class AuthEmail(BaseModel):
    email: str = Field(min_length=3, max_length=255)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        import re

        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("请输入有效的邮箱地址")
        return value


class EmailCodeRequest(AuthEmail):
    purpose: Literal["signup", "reset_password"]


class UserRegister(AuthEmail):
    password: str = Field(min_length=8, max_length=128)
    code: str = Field(pattern=r"^[0-9]{6}$")
    full_name: Optional[str] = Field(default=None, max_length=255)


class PasswordReset(AuthEmail):
    code: str = Field(pattern=r"^[0-9]{6}$")
    new_password: str = Field(min_length=8, max_length=128)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class UserPublic(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = None
    is_active: bool
    created_at: int


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
