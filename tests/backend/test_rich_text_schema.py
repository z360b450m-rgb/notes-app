"""Widening migration and new-model schema; no live database required."""
import unittest
from unittest.mock import MagicMock, patch
from sqlalchemy import Text
from sqlalchemy.dialects import mysql, sqlite
from sqlalchemy.dialects.mysql import LONGTEXT
from src.db_sql.migrate_rich_text import RICH_TEXT_COLUMNS, widen_rich_text_columns
from src.db_sql.models import NoteEntryModel, QuestionGroupModel


class RichTextSchemaTests(unittest.TestCase):
    def test_mysql_uses_longtext_and_sqlite_keeps_portable_text(self):
        for model, field in [(NoteEntryModel, name) for name in RICH_TEXT_COLUMNS['note_entries']] + [(QuestionGroupModel, 'material')]:
            column = model.__table__.columns[field]
            self.assertEqual(column.type.compile(dialect=mysql.dialect()), 'LONGTEXT')
            self.assertEqual(column.type.compile(dialect=sqlite.dialect()), 'TEXT')

    def test_migration_only_widens_expected_text_and_is_idempotent(self):
        engine = MagicMock()
        engine.dialect = mysql.dialect()
        inspector = MagicMock()
        inspector.get_columns.side_effect = lambda table: [dict(name=name, type=Text(), nullable=True, default=None) for name in RICH_TEXT_COLUMNS[table]]
        with patch('src.db_sql.migrate_rich_text.inspect', return_value=inspector):
            self.assertEqual(len(widen_rich_text_columns(engine)), 4)
        statements = [str(call.args[0]) for call in engine.begin.return_value.__enter__.return_value.execute.call_args_list]
        self.assertEqual(len(statements), 2)
        self.assertTrue(all('LONGTEXT NULL' in statement for statement in statements))
        engine.begin.reset_mock()
        inspector.get_columns.side_effect = lambda table: [dict(name=name, type=LONGTEXT(), nullable=True, default=None) for name in RICH_TEXT_COLUMNS[table]]
        with patch('src.db_sql.migrate_rich_text.inspect', return_value=inspector):
            self.assertEqual(widen_rich_text_columns(engine), [])
        engine.begin.assert_not_called()
