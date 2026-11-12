"""Durable answer/reason grading attempts, separate from completed review logs."""
from alembic import op
import sqlalchemy as sa

revision = 'a7c1e3f90642'
down_revision = 'f6b0d2e89531'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('review_attempts',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('user_id', sa.String(64), sa.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('entry_id', sa.String(64), sa.ForeignKey('note_entries.id', ondelete='CASCADE'), nullable=False),
        sa.Column('source_fingerprint', sa.String(64), nullable=False),
        sa.Column('answer_text', sa.Text(), nullable=False),
        sa.Column('explanation_text', sa.Text(), nullable=False),
        sa.Column('elapsed_ms', sa.BigInteger(), nullable=False),
        sa.Column('status', sa.String(32), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('lease_until', sa.BigInteger(), nullable=False),
        sa.Column('result', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.Column('updated_at', sa.BigInteger(), nullable=False))
    op.create_index('ix_review_attempts_user_id', 'review_attempts', ['user_id'])
    op.create_index('ix_review_attempts_entry_id', 'review_attempts', ['entry_id'])


def downgrade():
    op.drop_table('review_attempts')
