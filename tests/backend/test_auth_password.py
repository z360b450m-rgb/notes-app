"""Real auth API flows with isolated SQLite storage and mocked SMTP delivery."""

import os
import smtplib
import time
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.db_sql.auth import create_user
from src.db_sql.database import Base, get_db
from src.db_sql.email_verification import send_verification_email
from src.db_sql.models import EmailVerificationModel, UserModel
from src.db_sql.routers.auth import router


class AuthPasswordTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        app = FastAPI()
        app.include_router(router)

        def db_session():
            with self.sessions() as db:
                yield db

        app.dependency_overrides[get_db] = db_session
        self.client = TestClient(app)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.client.close)
        self.delivery = self.enterContext(patch("src.db_sql.email_verification.send_verification_email"))

    def create_account(self, email="alice@example.test"):
        with self.sessions() as db:
            create_user(db, email, "old-password")

    def issue(self, email="alice@example.test", purpose="reset_password"):
        response = self.client.post("/api/auth/email-code", json={"email": email, "purpose": purpose})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("code", response.json())
        return self.delivery.call_args.args[1]

    def login(self, password="old-password"):
        return self.client.post("/api/login/access-token", data={
            "username": "alice@example.test", "password": password,
        })

    def reset(self, code, password="new-password"):
        return self.client.post("/api/auth/reset-password", json={
            "email": "alice@example.test", "code": code, "new_password": password,
        })

    def test_signup_requires_valid_code_and_consumes_it(self):
        code = self.issue(" Alice@Example.Test ", "signup")
        self.assertEqual(self.delivery.call_args.args[0], "alice@example.test")
        payload = {"email": "alice@example.test", "password": "old-password", "code": code}
        self.assertEqual(self.client.post("/api/users/signup", json={
            "email": payload["email"], "password": payload["password"],
        }).status_code, 422)
        self.assertEqual(self.client.post("/api/users/signup", json=payload).status_code, 201)
        with self.sessions() as db:
            record = db.get(EmailVerificationModel, (payload["email"], "signup"))
            self.assertEqual(record.expires_at, 0)
            self.assertNotEqual(record.code_hash, code)
            self.assertNotEqual(db.query(UserModel).one().hashed_password, payload["password"])
        self.assertEqual(self.login().status_code, 200)

    def test_reset_revokes_all_old_tokens_and_rejects_replay(self):
        self.create_account()
        old_token = self.login().json()["access_token"]
        code = self.issue()
        self.assertEqual(self.reset(code).status_code, 200)
        self.assertEqual(self.login().status_code, 400)
        fresh = self.login("new-password")
        self.assertEqual(fresh.status_code, 200)
        self.assertEqual(self.client.get("/api/users/me", headers={
            "Authorization": "Bearer " + old_token,
        }).status_code, 401)
        self.assertEqual(self.client.get("/api/users/me", headers={
            "Authorization": "Bearer " + fresh.json()["access_token"],
        }).status_code, 200)
        self.assertEqual(self.reset(code, "third-password").status_code, 400)

    def test_change_password_checks_old_password_and_invalidates_tokens(self):
        self.create_account()
        headers = {"Authorization": "Bearer " + self.login().json()["access_token"]}
        payload = {"current_password": "incorrect", "new_password": "new-password"}
        self.assertEqual(self.client.post("/api/users/me/password", json=payload).status_code, 401)
        self.assertEqual(self.client.post("/api/users/me/password", json=payload, headers=headers).status_code, 400)
        payload["current_password"] = "old-password"
        payload["new_password"] = "old-password"
        self.assertEqual(self.client.post("/api/users/me/password", json=payload, headers=headers).status_code, 400)
        payload["new_password"] = "new-password"
        self.assertEqual(self.client.post("/api/users/me/password", json=payload, headers=headers).status_code, 200)
        self.assertEqual(self.client.get("/api/users/me", headers=headers).status_code, 401)
        self.assertEqual(self.login("new-password").status_code, 200)

    def test_expiry_attempt_limit_and_purpose_isolation(self):
        self.create_account()
        code = self.issue()
        self.assertEqual(self.client.post("/api/users/signup", json={
            "email": "bob@example.test", "password": "old-password", "code": code,
        }).status_code, 400)
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(5):
            self.assertEqual(self.reset(wrong).status_code, 400)
        self.assertEqual(self.reset(code).status_code, 400)
        with self.sessions() as db:
            row = db.get(EmailVerificationModel, ("alice@example.test", "reset_password"))
            row.attempts, row.expires_at = 0, time.time() - 1
            db.commit()
        self.assertEqual(self.reset(code).status_code, 400)

    def test_resend_limits_and_old_code_replacement(self):
        self.create_account()
        code = self.issue()
        body = {"email": "alice@example.test", "purpose": "reset_password"}
        response = self.client.post("/api/auth/email-code", json=body)
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)
        with self.sessions() as db:
            row = db.get(EmailVerificationModel, (body["email"], body["purpose"]))
            row.sent_at -= 61
            row.send_count = 5
            db.commit()
        self.assertEqual(self.client.post("/api/auth/email-code", json=body).status_code, 429)
        with self.sessions() as db:
            row = db.get(EmailVerificationModel, (body["email"], body["purpose"]))
            row.window_start -= 3601
            db.commit()
        with patch("src.db_sql.email_verification.secrets.randbelow", return_value=(int(code) + 1) % 1000000):
            replacement = self.issue()
        self.assertNotEqual(code, replacement)
        self.assertEqual(self.reset(code).status_code, 400)
        self.assertEqual(self.reset(replacement).status_code, 200)

    def test_failed_delivery_rolls_back_and_can_retry(self):
        self.create_account()
        self.delivery.side_effect = HTTPException(503, "邮件发送失败")
        self.assertEqual(self.client.post("/api/auth/email-code", json={
            "email": "alice@example.test", "purpose": "reset_password",
        }).status_code, 503)
        with self.sessions() as db:
            self.assertEqual(db.query(EmailVerificationModel).count(), 0)
        self.delivery.side_effect = None
        self.issue()

    def test_unknown_and_disabled_accounts_do_not_receive_reset_codes(self):
        body = {"email": "unknown@example.test", "purpose": "reset_password"}
        self.assertEqual(self.client.post("/api/auth/email-code", json=body).status_code, 200)
        self.delivery.assert_not_called()
        self.create_account()
        with self.sessions() as db:
            db.query(UserModel).one().is_active = False
            db.commit()
        body["email"] = "alice@example.test"
        self.assertEqual(self.client.post("/api/auth/email-code", json=body).status_code, 200)
        self.delivery.assert_not_called()

    def test_invalid_email_purpose_and_short_password_are_rejected(self):
        for email, purpose in [("invalid", "signup"), ("x\ny@example.test", "signup"), ("a@example.test", "login")]:
            self.assertEqual(self.client.post("/api/auth/email-code", json={
                "email": email, "purpose": purpose,
            }).status_code, 422)
        self.assertEqual(self.reset("123456", "short").status_code, 422)

    def test_smtp_ssl_starttls_missing_config_and_failure(self):
        with patch.dict(os.environ, {"SMTP_HOST": "", "SMTP_FROM": "", "SMTP_USERNAME": ""}):
            with self.assertRaises(HTTPException) as error:
                send_verification_email("alice@example.test", "123456", "signup")
            self.assertEqual(error.exception.status_code, 503)
        config = {"SMTP_HOST": "smtp.example.test", "SMTP_FROM": "sender@example.test",
                  "SMTP_USERNAME": "sender", "SMTP_PASSWORD": "secret", "SMTP_PORT": "465",
                  "SMTP_SSL": "true", "SMTP_STARTTLS": "false"}
        with patch.dict(os.environ, config), patch("smtplib.SMTP_SSL") as smtp:
            send_verification_email("alice@example.test", "123456", "signup")
            smtp.return_value.__enter__.return_value.login.assert_called_once_with("sender", "secret")
            message = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
            self.assertEqual(message["To"], "alice@example.test")
            self.assertIsNotNone(message["Date"])
            self.assertIsNotNone(message["Message-ID"])
            self.assertIn("123456", message.get_content())
        with patch.dict(os.environ, {**config, "SMTP_FROM": ""}), patch("smtplib.SMTP_SSL") as smtp:
            send_verification_email("alice@example.test", "123456", "signup")
            message = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
            self.assertEqual(message["From"], "sender")
        config.update(SMTP_SSL="false", SMTP_STARTTLS="true", SMTP_PORT="587")
        with patch.dict(os.environ, config), patch("smtplib.SMTP") as smtp:
            send_verification_email("alice@example.test", "123456", "reset_password")
            smtp.return_value.__enter__.return_value.starttls.assert_called_once()
        with patch.dict(os.environ, config), patch("smtplib.SMTP", side_effect=smtplib.SMTPException("private detail")):
            with self.assertRaises(HTTPException) as error:
                send_verification_email("alice@example.test", "123456", "signup")
            self.assertEqual(error.exception.status_code, 503)
            self.assertNotIn("private detail", error.exception.detail)


if __name__ == "__main__":
    unittest.main()
