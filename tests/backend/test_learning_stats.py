"""统计口径、日期边界、账号隔离与只读接口验证。"""

import unittest
from datetime import date
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from src.db_sql.auth import get_current_user
from src.db_sql.database import Base, get_db
from src.db_sql.main import app
from src.db_sql.models import UserModel, NotebookModel, NoteEntryModel, ReviewLogModel, TagModel
from src.db_sql.routers.learning_stats import StatsFilter, compute_stats, milliseconds


class LearningStatsTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.db = Session(engine)
        self.addCleanup(engine.dispose)
        self.addCleanup(self.db.close)
        self.addCleanup(app.dependency_overrides.clear)
        for owner in ('alice', 'bob'):
            self.db.add(UserModel(id=owner, email=f'{owner}@example.test', hashed_password='unused'))
            self.db.add(NotebookModel(id=owner, user_id=owner, name='数学本'))
        self.db.flush()
        a = NoteEntryModel(id='a', user_id='alice', notebook_id='alice', title='100%方程',
                           subject='数学', created_at=milliseconds(date(2026, 10, 12)), mastery_level=0)
        a.tags = [TagModel(id='tag', name='方程')]
        self.db.add_all([
            a,
            NoteEntryModel(id='b', user_id='alice', notebook_id='alice', title='几何', subject='数学',
                           created_at=milliseconds(date(2026, 10, 13))),
            NoteEntryModel(id='old', user_id='alice', notebook_id='alice', title='旧题', subject='数学',
                           created_at=milliseconds(date(2026, 10, 11))),
            NoteEntryModel(id='secret', user_id='bob', notebook_id='bob', title='其他账号秘密', subject='数学',
                           created_at=milliseconds(date(2026, 10, 12))),
        ])
        self.db.flush()
        for log_id, entry_id, correct in [('yes', 'a', True), ('no', 'a', False),
                                           ('unknown', 'a', None), ('secret-log', 'secret', False)]:
            self.db.add(ReviewLogModel(id=log_id, entry_id=entry_id, quality='test',
                                      timestamp=milliseconds(date(2026, 10, 12)), is_correct=correct))
        self.db.commit()

    def test_dates_account_counts_accuracy_and_previous_period(self):
        result = compute_stats(self.db, 'alice', StatsFilter(
            date_from='2026-10-12', date_to='2026-10-13', compare_previous=True,
        ))
        self.assertEqual(result['entry_count'], 1)
        self.assertEqual(result['review_count'], 3)
        self.assertEqual(result['judged_count'], 2)
        self.assertEqual(result['accuracy_percent'], 50)
        self.assertEqual(result['incorrect_count'], 1)
        self.assertEqual(result['previous_period']['entry_count'], 1)
        self.assertEqual(result['entry_daily'], [{'date': '2026-10-12', 'count': 1}])
        self.assertEqual(result['tags'], [{'name': '方程', 'count': 1}])
        self.assertEqual(result['mastery'], [{'name': -1, 'count': 1}])

    def test_list_filters_limit_and_literal_wildcards(self):
        result = compute_stats(self.db, 'alice', StatsFilter(kind='entries', limit=1, subject='数学'))
        self.assertEqual(result['entry_count'], 3)
        self.assertTrue(result['truncated'])
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['notebook_id'], 'alice')
        self.assertEqual(result['items'][0]['url'], '#/notebooks/alice/entries/b')
        reviews = compute_stats(self.db, 'alice', StatsFilter(kind='reviews'))
        self.assertTrue(all(row['url'] == '#/notebooks/alice/entries/a' for row in reviews['items']))
        filtered = compute_stats(self.db, 'alice', StatsFilter(keyword='%', tag='方程', notebook='数学本'))
        self.assertEqual(filtered['entry_count'], 1)

    def test_empty_result_is_not_zero_accuracy(self):
        result = compute_stats(self.db, 'alice', StatsFilter(subject='物理'))
        self.assertEqual(result['entry_count'], 0)
        self.assertEqual(result['review_count'], 0)
        self.assertIsNone(result['accuracy_percent'])

    def test_api_requires_login_and_rejects_owner_or_sql(self):
        with TestClient(app) as client:
            self.assertEqual(client.post('/api/review-agent/stats', json={}).status_code, 401)
            app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='alice')
            app.dependency_overrides[get_db] = lambda: self.db
            response = client.post('/api/review-agent/stats', json={'kind': 'entries'})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn('其他账号秘密', response.text)
            self.assertEqual(response.json()['entry_count'], 3)
            for payload in ({'user_id': 'bob'}, {'sql': 'DELETE FROM note_entries'},
                            {'date_from': '2026-10-13', 'date_to': '2026-10-12'}, {'limit': 10000}):
                self.assertEqual(client.post('/api/review-agent/stats', json=payload).status_code, 422)


if __name__ == '__main__':
    unittest.main()
