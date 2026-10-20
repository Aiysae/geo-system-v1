const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const localBrowsers = path.join(process.cwd(), '.data/local-publishing-browsers');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(localBrowsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;
const { chromium } = require('playwright');
const ctrip = require('../platform-adapters/ctrip.cjs');

const session = { cookies: [{ name: 'fixture', value: 'fixture', domain: '.ctrip.com', path: '/' }], origins: [] };
const title = '上海周末旅行路线';
const article = { title, markdown: '从外滩出发，沿江散步，再参观上海博物馆。', metadata: { contentType: 'imageText', assetIds: ['photo'] } };

test('Ctrip adapter reads back a draft ID from its mock draft list', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrip-adapter-'));
  const photo = path.join(directory, 'photo.png');
  fs.writeFileSync(photo, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'));
  const browser = await chromium.launch({ headless: true });
  let saved = false;
  try {
    const context = await browser.newContext();
    await context.route('https://we.ctrip.com/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/publish/contentManagement') {
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<script>window.clientAuth='account-123'</script>
          <button>草稿箱</button><main>${saved ? `<div class="c-m-c-container"><div class="top-title-bg"><div class="title">${title}</div></div>
          <div class="publish-status">草稿</div><div class="edit" onclick="location.href='/publish/publishPictureText?articleId=12345&articleStatus=DRAFT'">编辑</div></div>` : ''}</main>` });
      }
      if (url.pathname === '/publish/publishPictureText') {
        const existing = url.searchParams.has('articleId');
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<div class="publish-container"><div class="editor-body"><div class="public-DraftEditor-content" contenteditable="true">${existing ? title : ''}</div></div>
          <div class="editor-body"><div class="public-DraftEditor-content" contenteditable="true">${existing ? article.markdown : ''}</div></div>
          <input type="file" multiple onchange="this.insertAdjacentHTML('afterend','<div class=&quot;r-d-upload-image-container-done&quot;></div>')">
          ${existing ? '<div class="r-d-upload-image-container-done"></div>' : ''}
          <div class="r-d-button-container"><button onclick="window.__saved=true;location.href='/publish/contentManagement'">存草稿</button></div></div>` });
      }
      return route.abort();
    });
    const page = await context.newPage();
    // Keep the fixture's page navigation observable to the local test only.
    page.on('request', request => { if (request.isNavigationRequest() && page.url().endsWith('/publish/publishPictureText')) saved = true; });
    const profile = await ctrip.verifySession({ session, page });
    assert.equal(profile.ok, true, JSON.stringify(profile));
    assert.equal(profile.identity.id, 'account-123');
    const result = await ctrip.saveDraft({ session, article, resolvedAssets: { photo: { kind: 'image', pathOrUrl: photo } }, page });
    assert.deepEqual(result, { ok: true, remoteId: '12345' });
    await context.close();
  } finally { await browser.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Ctrip adapter rejects unsupported content and missing login without a write', async () => {
  const unsupported = await ctrip.saveDraft({ session, article: { ...article, metadata: { contentType: 'article' } } });
  assert.equal(unsupported.code, 'CONTENT_UNSUPPORTED');
  const noLogin = await ctrip.verifySession({ session: { cookies: [], origins: [] } });
  assert.equal(noLogin.code, 'AUTH');
});
