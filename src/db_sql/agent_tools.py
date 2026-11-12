from sqlalchemy import or_
from sqlalchemy.orm import Session

from src.db_sql.agent_db import agent_user_id, run_with_db
from src.db_sql.models import NoteEntryModel
from src.db_sql.crud import serialize_entry


def search_tool(keyword: str) -> str:
    """Search related mistake entries by keyword."""

    user_id = agent_user_id.get()
    if not user_id:
        raise PermissionError("Agent search requires an authenticated user scope")

    def query_entries(db: Session) -> str:
        entries = (
            db.query(NoteEntryModel)
            .filter(
                NoteEntryModel.user_id == user_id,
                or_(
                    NoteEntryModel.title.ilike(f"%{keyword}%"),
                    NoteEntryModel.question.ilike(f"%{keyword}%"),
                )
            )
            .order_by(NoteEntryModel.updated_at.desc())
            .limit(5)
            .all()
        )

        if not entries:
            return f"No mistake entries found for keyword: {keyword}"

        lines = [f"Found {len(entries)} mistake entries related to {keyword}:"]
        for index, entry in enumerate(entries, 1):
            title = entry.title or "Untitled"
            question = (entry.question or "").replace("\n", " ")[:120]
            counts = serialize_entry(entry)
            labels = ' · '.join(counts['learning_tags'])
            lines.append(f"{index}. {title} | {question} | {labels}（答错仅统计明确作答结果，独立于掌握程度）")

        return "\n".join(lines)

    return run_with_db(query_entries)
