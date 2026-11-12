"""SMTP delivery and database-backed, single-use email verification codes."""

import hashlib
import hmac
import math
import os
import secrets
import smtplib
import ssl
import time
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.db_sql.auth import SECRET_KEY
from src.db_sql.models import EmailVerificationModel

CODE_TTL_SECONDS = 600
RESEND_SECONDS = 60
MAX_ATTEMPTS = 5
MAX_SENDS_PER_HOUR = 5


def send_verification_email(email: str, code: str, purpose: str) -> None:
    host = os.getenv("SMTP_HOST", "").strip()
    sender = os.getenv("SMTP_FROM", "").strip() or os.getenv("SMTP_USERNAME", "").strip()
    if not host or not sender:
        raise HTTPException(503, "邮件服务尚未配置，请联系管理员")
    action = "注册账号" if purpose == "signup" else "重置密码"
    message = EmailMessage()
    message["Subject"] = f"ReNote {action}验证码"
    message["From"] = sender
    message["To"] = email
    message["Date"] = formatdate(localtime=False)
    message["Message-ID"] = make_msgid(domain=host)
    message.set_content(
        f"你的{action}验证码是：{code}\n\n"
        "验证码 10 分钟内有效，请勿向他人透露。\n如果这不是你的操作，请忽略此邮件。"
    )
    try:
        use_ssl = os.getenv("SMTP_SSL", "true").lower() == "true"
        use_starttls = os.getenv("SMTP_STARTTLS", "false").lower() == "true"
        if use_ssl and use_starttls:
            raise ValueError("Choose either SMTP_SSL or SMTP_STARTTLS")
        port = int(os.getenv("SMTP_PORT", "465" if use_ssl else "587"))
        client_type = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
        options = {"context": ssl.create_default_context()} if use_ssl else {}
        with client_type(host, port, timeout=10, **options) as client:
            if use_starttls:
                client.starttls(context=ssl.create_default_context())
            username = os.getenv("SMTP_USERNAME", "")
            if username:
                client.login(username, os.getenv("SMTP_PASSWORD", ""))
            client.send_message(message)
    except (OSError, smtplib.SMTPException, ValueError):
        raise HTTPException(503, "邮件发送失败，请稍后重试或联系管理员") from None


def code_digest(email: str, purpose: str, code: str) -> str:
    return hmac.new(
        SECRET_KEY.encode(), f"{email}:{purpose}:{code}".encode(), hashlib.sha256,
    ).hexdigest()


def issue_code(db: Session, email: str, purpose: str, *, deliver: bool = True) -> dict:
    now = time.time()
    record = db.query(EmailVerificationModel).filter_by(
        email=email, purpose=purpose,
    ).with_for_update().first()
    if record:
        wait = math.ceil(record.sent_at + RESEND_SECONDS - now)
        if wait > 0:
            raise HTTPException(429, f"请在 {wait} 秒后重新发送", headers={"Retry-After": str(wait)})
        if now - record.window_start >= 3600:
            record.window_start, record.send_count = now, 0
        if record.send_count >= MAX_SENDS_PER_HOUR:
            raise HTTPException(429, "发送次数过多，请一小时后再试")
    else:
        record = EmailVerificationModel(
            email=email, purpose=purpose, window_start=now, send_count=0,
        )
        db.add(record)
    code = f"{secrets.randbelow(1_000_000):06d}"
    record.code_hash = code_digest(email, purpose, code)
    record.expires_at = now + CODE_TTL_SECONDS if deliver else 0
    record.sent_at, record.attempts = now, 0
    record.send_count += 1
    try:
        db.flush()
        if deliver:
            send_verification_email(email, code, purpose)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(429, "验证码正在发送，请稍后重试") from None
    except Exception:
        db.rollback()
        raise
    return {"message": "如果该邮箱符合条件，验证码将发送至邮箱，请检查收件箱和垃圾邮件", "retry_after": RESEND_SECONDS}


def verify_code(db: Session, email: str, purpose: str, code: str) -> None:
    record = db.query(EmailVerificationModel).filter_by(
        email=email, purpose=purpose,
    ).with_for_update().first()
    if not record or record.expires_at <= time.time() or record.attempts >= MAX_ATTEMPTS:
        raise HTTPException(400, "验证码无效或已过期，请重新获取")
    if not hmac.compare_digest(record.code_hash, code_digest(email, purpose, code)):
        record.attempts += 1
        db.commit()
        raise HTTPException(400, "验证码不正确，请重新输入")
    # Consumed in the caller's transaction, so a failed password/user write does not burn the code.
    record.expires_at = 0
