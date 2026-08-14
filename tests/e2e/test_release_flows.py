"""Release-critical browser checks.

The script intentionally uses plain assertions rather than print-only checks so a
regression exits non-zero and blocks the workflow. It targets stable test ids
instead of localized UI labels, which makes the checks independent of copy edits.
"""

from __future__ import annotations

from pathlib import Path

from playwright.sync_api import Browser, Page, expect, sync_playwright

APP_URL = 'http://127.0.0.1:5173/'
SCREENSHOT_DIR = Path('test-results')


def fresh_page(browser: Browser) -> Page:
    context = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = context.new_page()
    page.goto(APP_URL, wait_until='networkidle')
    return page


def create_notebook(page: Page, name: str) -> None:
    create_button = page.get_by_test_id('create-notebook')
    expect(create_button).to_be_visible()
    create_button.click()
    page.get_by_test_id('notebook-name').fill(name)
    page.get_by_test_id('notebook-description').fill('Created by the release E2E suite')
    page.get_by_test_id('confirm-create-notebook').click()
    expect(page.get_by_text(name, exact=True).first).to_be_visible()


def test_notebook_creation(page: Page) -> None:
    create_notebook(page, 'Release E2E notebook')


def test_review_settings_save(page: Page) -> None:
    create_notebook(page, 'Settings E2E notebook')
    page.get_by_text('Settings E2E notebook', exact=True).first.click()

    settings = page.get_by_test_id('settings-toggle')
    expect(settings).to_be_visible()
    settings.click()

    review_settings = page.get_by_test_id('review-settings-toggle')
    expect(review_settings).to_be_visible()
    review_settings.click()

    first_review_days = page.get_by_test_id('first-review-days')
    expect(first_review_days).to_have_value('1')
    first_review_days.fill('10')
    page.get_by_test_id('save-review-settings').click()
    expect(page.get_by_test_id('save-review-settings')).not_to_be_visible()

    settings.click()
    page.get_by_test_id('review-settings-toggle').click()
    expect(page.get_by_test_id('first-review-days')).to_have_value('10')


def run() -> None:
    SCREENSHOT_DIR.mkdir(exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for test in (test_notebook_creation, test_review_settings_save):
                page = fresh_page(browser)
                try:
                    test(page)
                except Exception:
                    page.screenshot(path=SCREENSHOT_DIR / f'{test.__name__}.png', full_page=True)
                    raise
                finally:
                    page.context.close()
        finally:
            browser.close()


if __name__ == '__main__':
    run()
