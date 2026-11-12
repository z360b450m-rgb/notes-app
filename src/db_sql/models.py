import time

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Double,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.mysql import LONGTEXT

from src.db_sql.database import Base

RICH_TEXT = Text().with_variant(LONGTEXT(), 'mysql')


entry_tags = Table(
    "entry_tags",
    Base.metadata,
    Column("entry_id", String(64), ForeignKey("note_entries.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", String(64), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class NotebookModel(Base):
    __tablename__ = "notebooks"

    id = Column(String(64), primary_key=True, index=True)
    user_id = Column(String(64), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    instructions = Column(Text, nullable=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(BigInteger, default=lambda: int(time.time() * 1000))
    updated_at = Column(
        BigInteger,
        default=lambda: int(time.time() * 1000),
        onupdate=lambda: int(time.time() * 1000),
    )

    user = relationship("UserModel", back_populates="notebooks")
    entries = relationship("NoteEntryModel", back_populates="notebook", cascade="all, delete-orphan")
    question_groups = relationship("QuestionGroupModel", back_populates="notebook", cascade="all, delete-orphan")


class UserModel(Base):
    __tablename__ = "users"

    id = Column(String(64), primary_key=True, index=True)
    email = Column(String(255), nullable=False, unique=True, index=True)
    full_name = Column(String(255), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    password_changed_at = Column(Double, nullable=False, default=0, server_default="0")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(BigInteger, default=lambda: int(time.time() * 1000))

    notebooks = relationship("NotebookModel", back_populates="user", passive_deletes="all")
    entries = relationship("NoteEntryModel", back_populates="user", passive_deletes="all")


class EmailVerificationModel(Base):
    __tablename__ = "email_verifications"

    email = Column(String(255), primary_key=True)
    purpose = Column(String(32), primary_key=True)
    code_hash = Column(String(64), nullable=False)
    expires_at = Column(Double, nullable=False)
    sent_at = Column(Double, nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    window_start = Column(Double, nullable=False)
    send_count = Column(Integer, nullable=False, default=0)


class NoteEntryModel(Base):
    __tablename__ = "note_entries"

    id = Column(String(64), primary_key=True, index=True)
    user_id = Column(String(64), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    notebook_id = Column(String(64), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False, default="")
    question = Column(RICH_TEXT, nullable=True)
    wrong_answer = Column(RICH_TEXT, nullable=True)
    correct_answer = Column(RICH_TEXT, nullable=True)
    subject = Column(String(100), default="", index=True)
    source = Column(String(255), default="")
    drawings = Column(JSON, nullable=True)
    folder = Column(String(255), nullable=True, index=True)
    group_id = Column(String(64), nullable=True, index=True)
    sub_question_order = Column(Integer, nullable=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(BigInteger, default=lambda: int(time.time() * 1000))
    updated_at = Column(
        BigInteger,
        default=lambda: int(time.time() * 1000),
        onupdate=lambda: int(time.time() * 1000),
    )

    review_count = Column(Integer, default=0)
    consecutive_passes = Column(Integer, default=0)
    mastery_level = Column(Integer, default=0)
    ease_factor = Column(Float, default=2.5)
    interval = Column(Integer, default=0)
    last_review_date = Column(BigInteger, nullable=True)
    next_review_date = Column(BigInteger, nullable=True, index=True)

    user = relationship("UserModel", back_populates="entries")
    notebook = relationship("NotebookModel", back_populates="entries")
    tags = relationship("TagModel", secondary=entry_tags, back_populates="entries")
    review_logs = relationship("ReviewLogModel", back_populates="entry", cascade="all, delete-orphan")
    review_attempts = relationship("ReviewAttemptModel", back_populates="entry", cascade="all, delete-orphan")


class QuestionGroupModel(Base):
    __tablename__ = "question_groups"

    id = Column(String(64), primary_key=True, index=True)
    notebook_id = Column(String(64), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False, default="")
    material = Column(RICH_TEXT, nullable=True)
    drawings = Column(JSON, nullable=True)
    created_at = Column(BigInteger, default=lambda: int(time.time() * 1000))
    updated_at = Column(
        BigInteger,
        default=lambda: int(time.time() * 1000),
        onupdate=lambda: int(time.time() * 1000),
    )

    notebook = relationship("NotebookModel", back_populates="question_groups")


class TagModel(Base):
    __tablename__ = "tags"

    id = Column(String(64), primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True, index=True)
    created_at = Column(BigInteger, default=lambda: int(time.time() * 1000))
    updated_at = Column(
        BigInteger,
        default=lambda: int(time.time() * 1000),
        onupdate=lambda: int(time.time() * 1000),
    )

    entries = relationship("NoteEntryModel", secondary=entry_tags, back_populates="tags")


class ReviewLogModel(Base):
    __tablename__ = "review_logs"

    id = Column(String(64), primary_key=True, index=True)
    entry_id = Column(String(64), ForeignKey("note_entries.id", ondelete="CASCADE"), nullable=False, index=True)
    timestamp = Column(BigInteger, nullable=False, index=True)
    quality = Column(String(50), nullable=False)
    selected_choice = Column(Text, nullable=True)
    correct_choice = Column(Text, nullable=True)
    is_correct = Column(Boolean, nullable=True)
    session_id = Column(String(64), nullable=True)
    elapsed_ms = Column(BigInteger, nullable=True)
    review_note = Column(Text, nullable=True)
    answer_text = Column(Text, nullable=True)

    entry = relationship("NoteEntryModel", back_populates="review_logs")


class ReviewAttemptModel(Base):
    """独立作答与理由追问会话；最终完成前不生成复习日志。"""
    __tablename__ = 'review_attempts'
    id = Column(String(64), primary_key=True)
    user_id = Column(String(64), ForeignKey('users.id', ondelete='RESTRICT'), nullable=False, index=True)
    entry_id = Column(String(64), ForeignKey('note_entries.id', ondelete='CASCADE'), nullable=False, index=True)
    source_fingerprint = Column(String(64), nullable=False)
    answer_text = Column(Text, nullable=False)
    explanation_text = Column(Text, nullable=False, default='')
    elapsed_ms = Column(BigInteger, nullable=False, default=0)
    status = Column(String(32), nullable=False, default='ready')
    revision = Column(Integer, nullable=False, default=0)
    lease_until = Column(BigInteger, nullable=False, default=0)
    result = Column(JSON, nullable=True)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)
    entry = relationship('NoteEntryModel', back_populates='review_attempts')


class NotebookIndexModel(Base):
    """手动执行后才创建；保留删除源错题本后所需的索引清单。"""
    __tablename__ = 'notebook_indexes'
    __table_args__ = (UniqueConstraint('user_id', 'kb_id', 'notebook_id', name='uq_notebook_index_scope'),)
    id = Column(String(64), primary_key=True)
    user_id = Column(String(64), ForeignKey('users.id', ondelete='RESTRICT'), nullable=False, index=True)
    kb_id = Column(String(64), nullable=False)
    notebook_id = Column(String(64), nullable=False)
    notebook_name = Column(String(255), nullable=False)
    task_id = Column(String(64), nullable=False)
    status = Column(String(32), nullable=False)
    hashes = Column(JSON, nullable=False)
    snapshot = Column(JSON, nullable=False)
    report = Column(JSON, nullable=False)
    updated_at = Column(BigInteger, nullable=False)
