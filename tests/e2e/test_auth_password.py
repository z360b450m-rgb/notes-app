"""Auth page and settings flows against a mocked API; no live email or user changes."""

import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


def run():
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

    root = Path(__file__).resolve().parents[2]
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(root / "dist")))
    Thread(target=server.serve_forever, daemon=True).start()
    user = {"id": "auth-test", "email": "alice@example.test", "full_name": "Alice",
            "is_active": True, "created_at": 1}
    writes = []
    fail_send = False

    def api(route):
        request = route.request
        path = urlparse(request.url).path
        body = request.post_data_json if request.method == "POST" and "json" in request.headers.get("content-type", "") else None
        if request.method == "POST":
            writes.append((path, body))
        result, status = {"items": []}, 200
        if path == "/api/auth/email-code":
            result = {"message": "如果该邮箱符合条件，验证码将发送至邮箱", "retry_after": 60}
            if fail_send:
                result, status = {"detail": "邮件服务尚未配置，请联系管理员"}, 503
        elif path == "/api/auth/reset-password":
            assert body == {"email": user["email"], "code": "123456", "new_password": "new-password"}
            result = {"message": "密码已重置"}
        elif path == "/api/users/signup":
            assert body["code"] == "654321"
            result = user
        elif path == "/api/login/access-token":
            result = {"access_token": "test-token", "token_type": "bearer"}
        elif path == "/api/users/me":
            result = user
        elif path == "/api/users/me/password":
            assert request.headers["authorization"] == "Bearer test-token"
            assert body == {"current_password": "new-password", "new_password": "changed-password"}
            result = {"message": "密码已修改，请重新登录"}
        route.fulfill(status=status, content_type="application/json", body=json.dumps(result))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, channel=os.getenv("PLAYWRIGHT_CHANNEL", "msedge"))
        try:
            for width, height in ((1280, 900), (390, 844)):
                context = browser.new_context(viewport={"width": width, "height": height})
                context.route("http://localhost:8000/**", api)
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(f"http://127.0.0.1:{server.server_port}/app/", wait_until="domcontentloaded")
                page.get_by_role("button", name="忘记密码？", exact=True).click()
                page.get_by_label("邮箱", exact=True).fill(user["email"])
                fail_send = True
                page.get_by_role("button", name="发送验证码", exact=True).click()
                expect(page.get_by_role("alert")).to_have_text("邮件服务尚未配置，请联系管理员")
                expect(page.get_by_role("button", name="发送验证码", exact=True)).to_be_enabled()
                fail_send = False
                page.get_by_role("button", name="发送验证码", exact=True).click()
                expect(page.get_by_role("status")).to_contain_text("验证码")
                expect(page.get_by_role("button", name="秒后重发")).to_be_disabled()
                assert writes[-1] == ("/api/auth/email-code", {"email": user["email"], "purpose": "reset_password"})
                page.get_by_label("邮箱验证码", exact=True).fill("123456")
                page.get_by_label("新密码", exact=True).fill("new-password")
                page.get_by_label("确认密码", exact=True).fill("mismatch-password")
                page.get_by_role("button", name="重置密码", exact=True).click()
                expect(page.get_by_role("alert")).to_contain_text("不一致")
                page.get_by_label("确认密码", exact=True).fill("new-password")
                page.get_by_role("button", name="重置密码", exact=True).click()
                expect(page.get_by_role("status")).to_have_text("密码已重置，请使用新密码登录。")
                expect(page.get_by_label("密码", exact=True)).to_have_value("")
                page.get_by_role("button", name="注册", exact=True).click()
                page.get_by_role("button", name="发送验证码", exact=True).click()
                expect(page.get_by_role("button", name="秒后重发")).to_be_disabled()
                assert writes[-1] == ("/api/auth/email-code", {"email": user["email"], "purpose": "signup"})
                page.get_by_label("邮箱验证码", exact=True).fill("654321")
                page.get_by_label("密码", exact=True).fill("new-password")
                page.get_by_label("确认密码", exact=True).fill("new-password")
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
                if width == 1280:
                    output = root / ".dev-services" / "auth-password-preview.png"
                    output.parent.mkdir(exist_ok=True)
                    page.screenshot(path=str(output), full_page=True)
                page.locator(".auth-submit").click()
                expect(page.locator(".auth-page")).to_have_count(0)
                page.get_by_role("button", name="设置", exact=True).first.click()
                page.get_by_role("button", name="修改密码", exact=True).click()
                page.get_by_label("当前密码", exact=True).fill("new-password")
                page.get_by_label("新密码", exact=True).fill("changed-password")
                page.get_by_label("确认新密码", exact=True).fill("changed-password")
                page.get_by_role("button", name="确认修改并重新登录", exact=True).click()
                expect(page.locator(".auth-page")).to_be_visible()
                assert page.evaluate("localStorage.getItem('notes_app_access_token')") is None
                assert not errors, errors
                context.close()
                print(f"PASS: reset, signup, resend cooldown and password change ({width}x{height})")
        finally:
            browser.close()
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    run()
