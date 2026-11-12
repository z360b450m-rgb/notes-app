"""Persist manually triggered notebook index manifests."""
from alembic import op
import sqlalchemy as sa

revision = 'e5a9c1d78420'
down_revision = 'd4e8b3a9216f'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('notebook_indexes',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('user_id', sa.String(64), sa.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('kb_id', sa.String(64), nullable=False),
        sa.Column('notebook_id', sa.String(64), nullable=False),
        sa.Column('notebook_name', sa.String(255), nullable=False),
        sa.Column('task_id', sa.String(64), nullable=False),
        sa.Column('status', sa.String(32), nullable=False),
        sa.Column('hashes', sa.JSON(), nullable=False),
        sa.Column('snapshot', sa.JSON(), nullable=False),
        sa.Column('report', sa.JSON(), nullable=False),
        sa.Column('updated_at', sa.BigInteger(), nullable=False),
        sa.UniqueConstraint('user_id', 'kb_id', 'notebook_id', name='uq_notebook_index_scope'),
    )
    op.create_index('ix_notebook_indexes_user_id', 'notebook_indexes', ['user_id'])


def downgrade():
    op.drop_table('notebook_indexes')
