"""Idempotent, widening-only migration for HTML containing inline images.

Run: python -m src.db_sql.migrate_rich_text
"""
from sqlalchemy import Text, inspect, text
from sqlalchemy.dialects.mysql import LONGTEXT

RICH_TEXT_COLUMNS = {
    'note_entries': ('question', 'wrong_answer', 'correct_answer'),
    'question_groups': ('material',),
}


def widen_rich_text_columns(engine):
    if engine.dialect.name != 'mysql':
        return []
    inspector = inspect(engine)
    changes = []
    quote = engine.dialect.identifier_preparer.quote
    for table, fields in RICH_TEXT_COLUMNS.items():
        columns = {column['name']: column for column in inspector.get_columns(table)}
        modifications = []
        for field in fields:
            column = columns[field]
            old_type = column['type']
            if isinstance(old_type, LONGTEXT):
                continue
            if not isinstance(old_type, Text) or column.get('default') is not None or column.get('comment'):
                raise ValueError(f'Unexpected rich-text column definition: {table}.{field}')
            target = LONGTEXT(charset=getattr(old_type, 'charset', None),
                              collation=getattr(old_type, 'collation', None))
            nullable = 'NULL' if column['nullable'] else 'NOT NULL'
            modifications.append(f'MODIFY COLUMN {quote(field)} {target.compile(dialect=engine.dialect)} {nullable}')
            changes.append(f'{table}.{field}')
        if modifications:
            with engine.begin() as connection:
                connection.execute(text(f'ALTER TABLE {quote(table)} ' + ', '.join(modifications)))
    return changes


if __name__ == '__main__':
    from src.db_sql.database import engine
    changed = widen_rich_text_columns(engine)
    print('Expanded rich-text columns: ' + ', '.join(changed) if changed else 'Rich-text columns already support large images.')
