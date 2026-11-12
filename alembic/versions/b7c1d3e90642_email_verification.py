"""Email verification and password session revocation."""
from alembic import op
import sqlalchemy as sa

revision = "b7c1d3e90642"
down_revision = "a7c1e3f90642"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("password_changed_at", sa.Double(), nullable=False, server_default="0"))
    op.create_table(
        "email_verifications",
        sa.Column("email", sa.String(255), primary_key=True),
        sa.Column("purpose", sa.String(32), primary_key=True),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.Double(), nullable=False),
        sa.Column("sent_at", sa.Double(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("window_start", sa.Double(), nullable=False),
        sa.Column("send_count", sa.Integer(), nullable=False),
    )


def downgrade():
    op.drop_table("email_verifications")
    op.drop_column("users", "password_changed_at")
