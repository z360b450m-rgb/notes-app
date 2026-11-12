"""Review counters remain independent of ratings and unknown answer outcomes."""
import time
import unittest
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from src.db_sql import crud, notebook_index
from src.db_sql.auth import get_current_user
from src.db_sql.database import Base, get_db
from src.db_sql.main import app
from src.db_sql.models import NoteEntryModel, NotebookModel, ReviewLogModel, UserModel
from src.db_sql.routers.review_candidates import ReviewFilter, compute_candidates


class LearningCountTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.db = Session(engine)
        self.addCleanup(engine.dispose)
        self.addCleanup(self.db.close)
        self.addCleanup(app.dependency_overrides.clear)
        self.db.add(UserModel(id='alice', email='alice@test.local', hashed_password='unused'))
        self.db.flush()
        self.db.add(NotebookModel(id='book', user_id='alice', name='Test'))
        self.db.flush()
        crud.create_entry(self.db, 'book', 'Question', 'Explain why', entry_id='entry', user_id='alice')
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='alice')
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def review(self, log_id, quality, **outcome):
        response = self.client.post('/api/entries/entry/review', json={
            'id': log_id, 'quality': quality, **outcome,
        })
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_explicit_errors_unknowns_retries_and_ai_counts(self):
        self.assertIsNone(self.review('unknown', 'forgot')['is_correct'])
        self.assertIsNone(self.review('null', 'unfamiliar', is_correct=None)['is_correct'])
        self.review('right', 'forgot', is_correct=True)
        self.review('wrong', 'mastered', is_correct=False)
        self.review('wrong', 'mastered', is_correct=False)  # idempotent retry
        self.db.add(ReviewLogModel(id='future', entry_id='entry', quality='forgot',
                                  is_correct=False, timestamp=int(time.time() * 1000) + 86400000))
        self.db.commit()
        detail = self.client.get('/api/entries/entry?notebook_id=book').json()
        summary = self.client.get('/api/entries/summaries?notebook_id=book').json()['items'][0]
        candidate = compute_candidates(self.db, 'alice', ReviewFilter(scope='all'))['items'][0]
        for row in (detail, summary, candidate):
            self.assertEqual(row['review_count'], 4)
            self.assertEqual(row['wrong_count'], 1)
        self.assertEqual(candidate['learning_tags'], ['复习4次', '答错1次'])
        self.assertEqual(detail['learning_tags'], candidate['learning_tags'])

    def test_counter_sync_and_validation(self):
        response = self.client.patch('/api/entries/entry', json={'review_count': 7})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['review_count'], 7)
        self.assertEqual(response.json()['wrong_count'], 0)
        self.assertEqual(self.client.patch('/api/entries/entry', json={'review_count': -1}).status_code, 422)
        response = self.client.post('/api/entries', json={
            'id': 'imported', 'notebook_id': 'book', 'title': 'Imported', 'question': '', 'review_count': 5,
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['review_count'], 5)

    def test_independent_answer_is_saved_separately_and_retry_is_idempotent(self):
        original = self.db.get(NoteEntryModel, 'entry').wrong_answer
        result = self.review('answer', 'mastered', answer_text='  先移项\n再求解：x=1  ', is_correct=True)
        self.assertEqual(result['answer_text'], '先移项\n再求解：x=1')
        self.assertEqual(self.db.get(ReviewLogModel, 'answer').answer_text, result['answer_text'])
        self.assertEqual(self.db.get(NoteEntryModel, 'entry').wrong_answer, original)
        retried = self.review('answer', 'mastered', answer_text='不同答案', is_correct=True)
        self.assertEqual(retried['answer_text'], result['answer_text'])
        self.assertEqual(self.db.query(ReviewLogModel).count(), 1)
        self.assertEqual(self.review('empty-answer', 'forgot', answer_text='  ')['answer_text'], '')
        response = self.client.post('/api/entries/entry/review', json={'quality': 'mastered', 'answer_text': 'x'*20001})
        self.assertEqual(response.status_code, 422)

    def test_manual_index_refreshes_counts_but_ignores_mastery_rating(self):
        def snapshot():
            row = notebook_index.prepare_index(self.db, 'alice', 'knowledge', 'book')
            entry = row.snapshot['entries'][0]
            row.status = 'completed'
            self.db.commit()
            return entry
        original = snapshot()
        crud.update_entry(self.db, 'entry', {'mastery_level': 4}, user_id='alice')
        self.assertEqual(original['content_hash'], snapshot()['content_hash'])
        self.review('wrong', 'mastered', is_correct=False)
        changed = snapshot()
        self.assertNotEqual(original['content_hash'], changed['content_hash'])
        self.assertEqual(changed['learning_tags'], ['复习1次', '答错1次'])


if __name__ == '__main__':
    unittest.main()
