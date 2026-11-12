"""Keep independently entered review answers separate from notes and source answers."""
from alembic import op
import sqlalchemy as sa

revision = 'f6b0d2e89531'
down_revision = 'e5a9c1d78420'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('review_logs', sa.Column('answer_text', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('review_logs', 'answer_text')
