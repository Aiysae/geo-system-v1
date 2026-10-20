# -*- coding: utf-8 -*-
"""A late screenshot error must not outlive closing an account window.

Uses only the existing local demo account; creates no articles or publishing tasks.
"""
import os
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[3]
BASE = 'http://127.0.0.1:18860'
BROWSER = os.environ.get('LOCAL_PUBLISHER_BROWSER', str(
    ROOT / '.data/local-publishing-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell'))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=BROWSER)
    context = browser.new_context()
    page = context.new_page()
    page.goto(BASE + '/publishing', wait_until='networkidle')
    if '/sign-in' in page.url:
        page.locator('input[name=email]').fill('publishing-demo@local.test')
        page.locator('input[name=password]').fill('LocalDemo2026!')
        page.get_by_role('button', name='登录', exact=True).click()
        page.wait_for_url('**/publishing')
    demo = next(a for a in context.request.get(BASE + '/api/local-publishing').json()['accounts']
                if a['platform'] == 'DEMO_CSDN' and a['label'] == '演示甲')
    held_snapshots, held_closes = [], []

    def until(predicate):
        deadline = time.time() + 30
        while time.time() < deadline:
            if predicate():
                return
            page.wait_for_timeout(50)
        raise AssertionError('Expected intercepted account-window request')

    def intercept(route):
        request = route.request
        query = parse_qs(urlparse(request.url).query)
        if request.method == 'GET' and query.get('action') == ['login.snapshot'] and query.get('id') == [demo['id']]:
            held_snapshots.append(route)
        elif request.method == 'POST' and request.post_data_json.get('action') == 'login.close':
            held_closes.append(route)
        else:
            route.continue_()

    try:
        row = page.get_by_role('row').filter(has=page.get_by_text('演示甲', exact=True))
        row.get_by_role('button', name='打开账号窗口', exact=True).click()
        expect(page.get_by_alt_text('平台登录实时画面')).to_be_visible(timeout=60000)
        close = page.get_by_role('button', name='关闭登录窗口', exact=True)
        expect(close).to_be_enabled(timeout=60000)
        page.route('**/api/local-publishing**', intercept)
        until(lambda: held_snapshots)
        close.click()
        until(lambda: held_closes)
        held_snapshots.pop(0).fulfill(status=404, json={'error': '登录窗口已关闭，请重新打开'})
        page.wait_for_timeout(200)
        held_closes.pop(0).continue_()
        expect(page.get_by_role('dialog', name='平台账号登录')).not_to_be_visible(timeout=30000)
        expect(page.get_by_text('登录窗口已关闭，请重新打开', exact=True)).not_to_be_visible()
        page.unroute('**/api/local-publishing**', intercept)
        row.get_by_role('button', name='打开账号窗口', exact=True).click()
        expect(page.get_by_alt_text('平台登录实时画面')).to_be_visible(timeout=60000)
        close.click()
        expect(page.get_by_role('dialog', name='平台账号登录')).not_to_be_visible(timeout=30000)
        expect(page.get_by_text('登录窗口已关闭，请重新打开', exact=True)).not_to_be_visible()
        print('PASS: delayed screenshot error is ignored after close; demo session reopens; no publishing tasks created.')
    finally:
        context.request.post(BASE + '/api/local-publishing', data={
            'action': 'login.close', 'input': {'id': demo['id']}}, headers={'Origin': BASE})
        browser.close()
