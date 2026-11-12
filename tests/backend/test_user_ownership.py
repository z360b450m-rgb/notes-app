"""Run with: python -m unittest discover -s tests/backend -v."""

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.db_sql.agent_db import agent_user_scope
from src.db_sql.agent_tools import search_tool
from src.db_sql.auth import create_access_token
from src.db_sql.database import Base, get_db
from src.db_sql.main import app
from src.db_sql.models import NoteEntryModel, NotebookModel, UserModel


class UserOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )

        @event.listens_for(self.engine, "connect")
        def enforce_foreign_keys(connection, _record):
            connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        with self.sessions() as db:
            db.add_all([
                UserModel(id="alice", email="alice@example.test", hashed_password="unused"),
                UserModel(id="bob", email="bob@example.test", hashed_password="unused"),
            ])
            db.commit()

        def test_db():
            with self.sessions() as db:
                yield db

        app.dependency_overrides[get_db] = test_db
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.addCleanup(app.dependency_overrides.clear)
        self.addCleanup(self.engine.dispose)
        for owner in ("alice", "bob"):
            self.request(owner, "POST", "/notebooks", {"id": owner + "-nb", "name": owner}, 201)
            self.request(owner, "POST", "/question-groups", {
                "id": owner + "-group", "notebook_id": owner + "-nb", "material": owner + " secret",
            }, 201)
            self.request(owner, "POST", "/entries", {
                "id": owner + "-entry", "notebook_id": owner + "-nb", "title": owner + " secret",
                "question": "shared-keyword", "group_id": owner + "-group", "sub_question_order": 1,
            }, 201)

    def request(self, user, method, path, body=None, status=200):
        headers = {"Authorization": "Bearer " + create_access_token(user)} if user else {}
        response = self.client.request(method, "/api" + path, json=body, headers=headers)
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def test_server_assigns_owner_and_relationships(self):
        result = self.request("alice", "POST", "/entries", {
            "id": "spoof-owner", "notebook_id": "alice-nb", "title": "test", "question": "test",
            "user_id": "bob",
        }, 201)
        self.assertEqual(result["user_id"], "alice")
        result = self.request("alice", "PATCH", "/entries/spoof-owner", {
            "title": "updated", "user_id": "bob",
        })
        self.assertEqual(result["user_id"], "alice")
        with self.sessions() as db:
            self.assertEqual(db.get(NoteEntryModel, "spoof-owner").user.id, "alice")
            self.assertEqual({item.id for item in db.get(UserModel, "alice").notebooks}, {"alice-nb"})
            with self.assertRaises(IntegrityError):
                db.add(NoteEntryModel(id="invalid-user", user_id="missing", notebook_id="alice-nb"))
                db.commit()

    def test_lists_and_search_only_own_data(self):
        self.assertEqual([item["id"] for item in self.request("bob", "GET", "/notebooks")["items"]], ["bob-nb"])
        result = self.request("bob", "GET", "/entries/search?notebook_id=bob-nb&q=shared-keyword")
        self.assertEqual([item["id"] for item in result["items"]], ["bob-entry"])
        self.request("bob", "GET", "/entries/search?notebook_id=alice-nb", status=404)
        self.request("bob", "GET", "/question-groups?notebook_id=alice-nb", status=404)
        self.request(None, "GET", "/notebooks", status=401)

    def test_cross_user_reads_updates_deletes_and_reviews_denied(self):
        for method, path, body in [
            ("GET", "/notebooks/alice-nb", None),
            ("PATCH", "/notebooks/alice-nb", {"name": "stolen"}),
            ("DELETE", "/notebooks/alice-nb", None),
            ("PATCH", "/entries/alice-entry", {"title": "stolen"}),
            ("DELETE", "/entries/alice-entry", None),
            ("PATCH", "/question-groups/alice-group", {"material": "stolen"}),
            ("DELETE", "/question-groups/alice-group", None),
            ("POST", "/entries/alice-entry/review", {"quality": "good"}),
        ]:
            with self.subTest(method=method, path=path):
                self.request("bob", method, path, body, 404)
        self.assertEqual(self.request("alice", "GET", "/notebooks/alice-nb")["name"], "alice")

    def test_cross_user_id_replays_and_foreign_parents_denied(self):
        self.request("bob", "POST", "/notebooks", {"id": "alice-nb", "name": "stolen"}, 409)
        self.request("bob", "POST", "/entries", {
            "id": "alice-entry", "notebook_id": "bob-nb", "title": "stolen", "question": "stolen",
        }, 409)
        self.request("bob", "POST", "/question-groups", {
            "id": "alice-group", "notebook_id": "bob-nb", "material": "stolen",
        }, 404)
        self.request("bob", "POST", "/entries", {
            "notebook_id": "alice-nb", "title": "stolen", "question": "stolen",
        }, 404)
        self.request("bob", "POST", "/question-groups", {"notebook_id": "alice-nb"}, 404)
        self.request("bob", "PATCH", "/entries/bob-entry", {"group_id": "alice-group"}, 404)

    def test_group_consistency_and_safe_deletion(self):
        self.request("alice", "POST", "/notebooks", {"id": "other-nb", "name": "other"}, 201)
        self.request("alice", "POST", "/question-groups", {"id": "other-group", "notebook_id": "other-nb"}, 201)
        self.request("alice", "PATCH", "/entries/alice-entry", {"group_id": "other-group"}, 400)
        self.request("alice", "DELETE", "/question-groups/alice-group")
        result = self.request("alice", "GET", "/entries/search?notebook_id=alice-nb")["items"][0]
        self.assertIsNone(result["group_id"])
        self.assertIsNone(result["sub_question_order"])
        self.request("alice", "DELETE", "/notebooks/alice-nb")
        self.assertEqual(len(self.request("bob", "GET", "/entries/search?notebook_id=bob-nb")["items"]), 1)

    def test_review_retry_does_not_reuse_another_entrys_log(self):
        body = {"id": "alice-log", "quality": "good"}
        self.request("alice", "POST", "/entries/alice-entry/review", body)
        self.request("alice", "POST", "/entries/alice-entry/review", body)
        self.request("bob", "POST", "/entries/bob-entry/review", body, 409)

    def test_agent_search_is_scoped_and_fails_without_identity(self):
        with self.assertRaises(PermissionError):
            search_tool("shared-keyword")
        with self.sessions() as db, patch("src.db_sql.agent_tools.run_with_db", side_effect=lambda fn: fn(db)):
            with agent_user_scope("bob"):
                result = search_tool("shared-keyword")
                self.assertIn("bob secret", result)
                self.assertNotIn("alice secret", result)
        with self.assertRaises(PermissionError):
            search_tool("shared-keyword")


if __name__ == "__main__":
    unittest.main()
