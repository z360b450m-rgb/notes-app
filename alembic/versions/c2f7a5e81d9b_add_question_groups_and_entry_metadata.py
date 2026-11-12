"""add question groups and entry metadata

Revision ID: c2f7a5e81d9b
Revises: 8c1f8e2d3a44
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c2f7a5e81d9b"
down_revision: Union[str, Sequence[str], None] = "8c1f8e2d3a44"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("note_entries", sa.Column("folder", sa.String(length=255), nullable=True))
    op.add_column("note_entries", sa.Column("group_id", sa.String(length=64), nullable=True))
    op.add_column("note_entries", sa.Column("sub_question_order", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_note_entries_folder"), "note_entries", ["folder"], unique=False)
    op.create_index(op.f("ix_note_entries_group_id"), "note_entries", ["group_id"], unique=False)
    op.create_table(
        "question_groups",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("notebook_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("material", sa.Text(), nullable=True),
        sa.Column("drawings", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["notebook_id"], ["notebooks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_question_groups_id"), "question_groups", ["id"], unique=False)
    op.create_index(op.f("ix_question_groups_notebook_id"), "question_groups", ["notebook_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_question_groups_notebook_id"), table_name="question_groups")
    op.drop_index(op.f("ix_question_groups_id"), table_name="question_groups")
    op.drop_table("question_groups")
    op.drop_index(op.f("ix_note_entries_group_id"), table_name="note_entries")
    op.drop_index(op.f("ix_note_entries_folder"), table_name="note_entries")
    op.drop_column("note_entries", "sub_question_order")
    op.drop_column("note_entries", "group_id")
    op.drop_column("note_entries", "folder")
