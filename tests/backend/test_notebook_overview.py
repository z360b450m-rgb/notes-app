"""Dashboard count accuracy, ownership, offline projections and bounded SQL work."""
import unittest
from datetime import datetime
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from src.db_sql.auth import get_current_user
from src.db_sql.database import Base, get_db
from src.db_sql.models import UserModel, NotebookModel, NoteEntryModel, ReviewLogModel
from src.db_sql.notebook_overview import OverviewRequest, notebook_overview, DAY_MS
from src.db_sql.routers.notebooks import router

NOW = int(datetime.fromisoformat('2026-10-16T00:30:00+08:00').timestamp() * 1000)
TODAY = NOW - 30 * 60000


class NotebookOverviewTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)
        for owner in ['alice', 'bob']:
            self.db.add(UserModel(id=owner, email=f'{owner}@example.test', hashed_password='unused'))
        self.db.flush()
        self.db.add_all([NotebookModel(id=f'a{i}', name=f'Book {i}', user_id='alice') for i in range(12)])
        self.db.add(NotebookModel(id='secret', name='Secret', user_id='bob'))
        self.db.flush()
        for entry_id, due, subject in [('due', NOW - 1, '数学'), ('boundary', NOW, '数学'),
                                        ('future', NOW + 1, ''), ('zero', 0, ''), ('unset', None, '')]:
            self.db.add(NoteEntryModel(id=entry_id, notebook_id='a0', user_id='alice',
                                      next_review_date=due, subject=subject, question='huge-image' * 10000))
        self.db.add(NoteEntryModel(id='private', notebook_id='secret', user_id='bob', next_review_date=1))
        self.db.flush()
        for log_id, entry_id, timestamp in [('midnight', 'due', TODAY), ('today', 'due', NOW),
                                            ('yesterday', 'boundary', TODAY - 1),
                                            ('week', 'due', TODAY - 6 * DAY_MS),
                                            ('old', 'due', TODAY - 6 * DAY_MS - 1),
                                            ('future-log', 'due', NOW + 1),
                                            ('orphan', 'deleted-entry', NOW), ('private-log', 'private', NOW)]:
            self.db.add(ReviewLogModel(id=log_id, entry_id=entry_id, timestamp=timestamp, quality='submitted'))
        self.db.commit()

    def overview(self, **kwargs):
        return notebook_overview(self.db, 'alice', OverviewRequest(**kwargs), now=NOW)

    def test_counts_boundaries_and_constant_queries_without_content(self):
        statements = []
        def capture(_conn, _cursor, statement, _params, _context, _many):
            statements.append(statement)
        event.listen(self.engine, 'before_cursor_execute', capture)
        result = self.overview()
        event.remove(self.engine, 'before_cursor_execute', capture)
        self.assertEqual(len(statements), 5, 'Twelve notebooks use five grouped queries, not per-book queries')
        self.assertFalse(any('note_entries.question' in sql or 'review_logs.answer_text' in sql for sql in statements))
        items = {item['notebookId']: item for item in result['items']}
        self.assertEqual(len(items), 12)
        self.assertEqual(items['a0'], dict(notebookId='a0', entryCount=5, dueCount=2, reviewedToday=2))
        self.assertEqual(items['a1'], dict(notebookId='a1', entryCount=0, dueCount=0, reviewedToday=0))
        self.assertEqual(result['subjects'], [{'name': '未分类', 'count': 3}, {'name': '数学', 'count': 2}])
        self.assertEqual([day['count'] for day in result['reviewDays']], [1, 0, 0, 0, 0, 1, 2])
        self.assertNotIn('private', str(result))

    def test_pending_create_update_delete_and_review_deduplication(self):
        result = self.overview(
            entries=[dict(id='due', notebook_id='a0', next_review_date=NOW + 100, subject='物理'),
                     dict(id='new', notebook_id='a0', next_review_date=NOW, subject='物理')],
            deleted_entry_ids=['boundary'],
            reviews=[dict(id='today', entry_id='due', timestamp=NOW),
                     dict(id='pending', entry_id='new', timestamp=NOW),
                     dict(id='removed', entry_id='boundary', timestamp=NOW),
                     dict(id='foreign', entry_id='private', timestamp=NOW)])
        self.assertEqual(result['items'][0], dict(notebookId='a0', entryCount=5, dueCount=1, reviewedToday=3))
        self.assertEqual(sum(day['count'] for day in result['reviewDays']), 4)
        self.assertEqual(sum(subject['count'] for subject in result['subjects']), 5)
        # Persist the same queue, then retry: no double counting at sync completion.
        entry = self.db.get(NoteEntryModel, 'due')
        entry.next_review_date, entry.subject = NOW + 100, '物理'
        self.db.delete(self.db.get(NoteEntryModel, 'boundary'))
        self.db.add(NoteEntryModel(id='new', notebook_id='a0', user_id='alice', next_review_date=NOW, subject='物理'))
        self.db.flush()
        self.db.add(ReviewLogModel(id='pending', entry_id='new', timestamp=NOW, quality='submitted'))
        self.db.commit()
        self.assertEqual(self.overview(), result)

    def test_timezone_and_empty_account(self):
        result = self.overview(utc_offset_minutes=0)
        self.assertEqual(result['reviewDays'][-1]['timestamp'], TODAY - 16 * 3600000)
        self.assertEqual(result['items'][0]['reviewedToday'], 3)
        empty = notebook_overview(self.db, 'nobody', OverviewRequest(), now=NOW)
        self.assertEqual(empty['items'], [])
        self.assertEqual(empty['subjects'], [])
        self.assertEqual(sum(day['count'] for day in empty['reviewDays']), 0)

    def test_local_only_data_and_newer_versions_without_sync_queue(self):
        result = self.overview(local_entries=[
            dict(id='local-only', notebook_id='a0', next_review_date=NOW, subject='英语', updated_at=1),
            dict(id='due', notebook_id='a0', next_review_date=NOW + 100, subject='英语', updated_at=9999999999999),
            # An older local copy must not override a newer server schedule.
            dict(id='boundary', notebook_id='a0', next_review_date=NOW + 100, subject='英语', updated_at=1),
        ], local_reviews=[dict(id='local-review', entry_id='local-only', timestamp=NOW),
                          dict(id='today', entry_id='due', timestamp=NOW)])
        self.assertEqual(result['items'][0], dict(notebookId='a0', entryCount=6, dueCount=2, reviewedToday=3))
        self.assertIn(dict(name='英语', count=2), result['subjects'])
        self.assertEqual(sum(day['count'] for day in result['reviewDays']), 5)

    def test_authenticated_aggregate_route(self):
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        with TestClient(app) as client:
            self.assertEqual(client.post('/api/notebooks/overview', json={}).status_code, 401)
            app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='alice')
            response = client.post('/api/notebooks/overview', json={})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(len(response.json()['items']), 12)
            self.assertNotIn('huge-image', response.text)
            self.assertNotIn('secret', response.text)
            self.assertEqual(client.post('/api/notebooks/overview', json={'user_id': 'bob'}).status_code, 422)


if __name__ == '__main__':
    unittest.main()
