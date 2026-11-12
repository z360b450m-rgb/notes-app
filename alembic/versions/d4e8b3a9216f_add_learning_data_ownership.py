"""Bind notebooks and entries to users, preserving existing learning data."""

import sqlalchemy as sa
from alembic import context, op

revision = "d4e8b3a9216f"
down_revision = "c2f7a5e81d9b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    legacy_count = connection.execute(sa.text("SELECT COUNT(*) FROM notebooks")).scalar()
    owner_id = None
    if legacy_count:
        users = connection.execute(sa.text("SELECT id FROM users")).scalars().all()
        owner_id = context.get_x_argument(as_dictionary=True).get("legacy_user_id")
        if owner_id is None and len(users) == 1:
            owner_id = users[0]
        if owner_id not in users:
            raise RuntimeError(
                "Existing learning data needs an owner. Run alembic "
                "-x legacy_user_id=<existing-user-id> upgrade head."
            )
    # Validate before MySQL's non-transactional DDL changes anything.
    for table in ("note_entries", "question_groups"):
        orphan_count = connection.execute(sa.text(
            f"SELECT COUNT(*) FROM {table} child LEFT JOIN notebooks parent "
            "ON child.notebook_id = parent.id WHERE parent.id IS NULL"
        )).scalar()
        if orphan_count:
            raise RuntimeError(f"{table} contains records without a notebook; repair them first.")

    for table in ("notebooks", "note_entries"):
        op.add_column(table, sa.Column("user_id", sa.String(64), nullable=True))
    if owner_id:
        connection.execute(sa.text("UPDATE notebooks SET user_id = :owner"), {"owner": owner_id})
        connection.execute(sa.text(
            "UPDATE note_entries SET user_id = "
            "(SELECT notebooks.user_id FROM notebooks WHERE notebooks.id = note_entries.notebook_id)"
        ))
    for table in ("notebooks", "note_entries"):
        op.alter_column(table, "user_id", existing_type=sa.String(64), nullable=False)
        op.create_index(f"ix_{table}_user_id", table, ["user_id"])
        op.create_foreign_key(f"fk_{table}_user_id", table, "users", ["user_id"], ["id"], ondelete="RESTRICT")


def downgrade() -> None:
    for table in ("note_entries", "notebooks"):
        op.drop_constraint(f"fk_{table}_user_id", table, type_="foreignkey")
        op.drop_index(f"ix_{table}_user_id", table_name=table)
        op.drop_column(table, "user_id")
