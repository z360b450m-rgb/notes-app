import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.db_sql.auth import create_access_token
from src.db_sql.database import Base, get_db
from src.db_sql.main import app
from src.db_sql.models import NoteEntryModel, NotebookModel, QuestionGroupModel, TagModel, UserModel


class LazyEntryTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        with self.sessions() as db:
            db.add_all([UserModel(id=x, email=x+'@example.test', hashed_password='unused') for x in ['alice', 'bob']])
            db.add_all([NotebookModel(id=x+'-nb', name=x, user_id=x) for x in ['alice', 'bob']])
            db.commit()
            db.add(NotebookModel(id='other-nb', name='other', user_id='alice'))
            db.add(QuestionGroupModel(id='group', notebook_id='alice-nb', title='group', material='shared-material-token'))
            tag = TagModel(id='tag', name='tag-token')
            db.add_all([NoteEntryModel(
                id=f'entry-{i}', user_id='alice', notebook_id='alice-nb', title=f'Title {i}',
                question='question-token' + 'X' * 100000, wrong_answer='wrong-token',
                correct_answer='correct-token', drawings={'question': 'Y' * 100000},
                group_id='group', subject='Math', tags=[tag], folder='folder', sort_order=i,
                review_count=3, next_review_date=123,
            ) for i in range(30)])
            db.commit()
        def session():
            with self.sessions() as db:
                yield db
        app.dependency_overrides[get_db] = session
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.addCleanup(app.dependency_overrides.clear)
        self.addCleanup(self.engine.dispose)

    def get(self, path, owner='alice', status=200):
        response = self.client.get('/api/'+path, headers={'Authorization': 'Bearer '+create_access_token(owner)})
        self.assertEqual(response.status_code, status, response.text[:300])
        return response

    def test_small_metadata_payload_and_bounded_queries(self):
        statements = []
        def capture(_conn, _cursor, statement, _params, _context, _many):
            statements.append(statement)
        event.listen(self.engine, 'before_cursor_execute', capture)
        result = self.get('entries/summaries?notebook_id=alice-nb')
        self.assertLess(len(result.content), 25000)
        self.assertLessEqual(len(statements), 5, 'Avoid per-entry tag queries')
        for row in result.json()['items']:
            self.assertFalse({'question', 'wrong_answer', 'correct_answer', 'drawings'} & row.keys())
            self.assertEqual(row['tags'], ['tag-token'])
            self.assertEqual(row['folder'], 'folder')
            self.assertEqual(row['next_review_date'], 123)
            self.assertLessEqual(len(row['question_preview']), 240)
        groups = self.get('question-groups/summaries?notebook_id=alice-nb').json()['items']
        self.assertEqual(groups[0]['id'], 'group')
        self.assertNotIn('material', groups[0])

    def test_searches_unloaded_answers_material_tags_and_literal_wildcards(self):
        for query in ['question-token', 'wrong-token', 'correct-token', 'shared-material-token', 'tag-token']:
            self.assertEqual(len(self.get('entries/summaries?notebook_id=alice-nb&q='+query).json()['items']), 30)
        self.assertEqual(self.get('entries/summaries?notebook_id=alice-nb&q=%25').json()['items'], [])
        self.assertEqual(len(self.get('entries/summaries?notebook_id=alice-nb&q=Title%2017').json()['items']), 1)

    def test_detail_reads_and_owner_notebook_checks(self):
        detail = self.get('entries/entry-0?notebook_id=alice-nb').json()
        self.assertEqual(detail['correct_answer'], 'correct-token')
        self.assertGreater(len(detail['question']), 100000)
        self.assertEqual(self.get('question-groups/group?notebook_id=alice-nb').json()['material'], 'shared-material-token')
        for path in ['entries/summaries?notebook_id=alice-nb', 'question-groups/summaries?notebook_id=alice-nb',
                     'entries/entry-0?notebook_id=alice-nb', 'question-groups/group?notebook_id=alice-nb']:
            self.get(path, owner='bob', status=404)
        self.get('entries/entry-0?notebook_id=other-nb', status=404)
        self.get('question-groups/group?notebook_id=other-nb', status=404)


if __name__ == '__main__':
    unittest.main()
