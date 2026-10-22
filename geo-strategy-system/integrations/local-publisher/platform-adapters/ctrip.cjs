// Ctrip Content Center: image/text notes only. This adapter uses the site's own
// editor and draft list; it does not call unpublished write APIs or publish.
const {captureSession}=require('../session.cjs');
const fs = require('node:fs');
const path = require('node:path');
const localBrowsers = path.join(process.cwd(), '.data/local-publishing-browsers');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(localBrowsers)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;
}
const { chromium } = require('playwright');

const HOME = 'https://we.ctrip.com';
const loginUrls = {
  authorizeUrl: `${HOME}/account/login`,
  entryUrl: `${HOME}/publish/contentManagement`,
};
const EDITOR = `${HOME}/publish/publishPictureText`;
const privateHost = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::|\[?f[cd])/i;

function isCtripHost(hostname) {
  const host = String(hostname || '').replace(/^\./, '').toLowerCase();
  return !privateHost.test(host) && (
    host === 'ctrip.com' || host.endsWith('.ctrip.com') ||
    host === 'c-ctrip.com' || host.endsWith('.c-ctrip.com') ||
    host === 'tripcdn.cn' || host.endsWith('.tripcdn.cn')
  );
}

function scopedSession(session) {
  const origins = (session?.origins || []).filter(origin => {
    try { const url = new URL(origin.origin); return url.protocol === 'https:' && isCtripHost(url.hostname); }
    catch { return false; }
  });
  return {
    cookies: (session?.cookies || []).filter(cookie => isCtripHost(cookie.domain)),
    origins,
  };
}

async function withPage(session, suppliedPage, work) {
  if (suppliedPage) return work(suppliedPage);
  const candidates = [process.env.LOCAL_PUBLISHER_BROWSER, chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].filter(Boolean);
  const executablePath = candidates.find(candidate => fs.existsSync(candidate));
  if (!executablePath) return { ok: false, code: 'BROWSER', message: '本机缺少可用浏览器' };
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const state = scopedSession(session);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 }, storageState: state,
      serviceWorkers: 'block', acceptDownloads: false,
    });
    try {
      if (session?.sessionStorage) {
        const values = Object.fromEntries(Object.entries(session.sessionStorage).filter(([origin]) => {
          try { const url = new URL(origin); return url.protocol === 'https:' && isCtripHost(url.hostname); }
          catch { return false; }
        }));
        await context.addInitScript(data => {
          const items = data[location.origin];
          if (items) for (const [key, value] of Object.entries(items)) sessionStorage.setItem(key, value);
        }, values);
      }
      await context.route('**/*', route => {
        let url;
        try { url = new URL(route.request().url()); }
        catch { return route.abort(); }
        return url.protocol === 'https:' && isCtripHost(url.hostname) ? route.continue() : route.abort();
      });
      const result=await work(await context.newPage());
      return {...result,session:await captureSession(context,session)};
    } finally { await context.close(); }
  } finally { await browser.close(); }
}

function failure(error, attempted = false) {
  const message = String(error?.message || error || '携程内容中心未返回明确结果');
  if (/\/account\/login|登录|未登录|unauth|expired/i.test(message)) {
    return { ok: false, code: 'AUTH', message: '携程账号需要重新登录' };
  }
  return { ok: false, code: attempted ? 'NEEDS_REVIEW' : 'PLATFORM',
    message: attempted ? '草稿提交结果未核实，请到携程草稿箱核对后再试' : message.slice(0, 180) };
}

async function verifyOnPage(page) {
  await page.goto(loginUrls.entryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try { await page.getByText('草稿箱', { exact: false }).first().waitFor({ timeout: 10000 }); }
  catch {
    if (new URL(page.url()).pathname.startsWith('/account/')) {
      return { ok: false, code: 'AUTH', message: '请先登录携程内容中心' };
    }
    return { ok: false, code: 'PROFILE_UNVERIFIED', message: '携程内容中心未显示账号管理页' };
  }
  if (new URL(page.url()).pathname !== '/publish/contentManagement') {
    return { ok: false, code: 'AUTH', message: '携程未进入已登录内容管理页' };
  }
  try { await page.waitForFunction(() => !!window.clientAuth, null, { timeout: 10000 }); }
  catch { return { ok: false, code: 'PROFILE_UNVERIFIED', message: '已进入内容管理页，但尚未取得稳定的携程账号编号' }; }
  // The official editor uses clientAuth as the account identifier. Read it
  // from the authenticated page, never infer an identity from cookies alone.
  const identity = await page.evaluate(() => {
    const id = String(window.clientAuth || '').trim();
    const name = document.querySelector('[class*="header"] [class*="user-name"], [class*="header"] [class*="nickname"]')?.textContent?.trim();
    return { id, name: name || '' };
  });
  if (!identity.id || !/^[a-zA-Z0-9_-]{2,100}$/.test(identity.id)) {
    return { ok: false, code: 'PROFILE_UNVERIFIED', message: '已进入内容管理页，但尚未取得稳定的携程账号编号' };
  }
  return { ok: true, identity: { id: identity.id, name: identity.name || `携程账号 ${identity.id}` } };
}

async function verifySession({ session, page } = {}) {
  if (!scopedSession(session).cookies.length) return { ok: false, code: 'AUTH', message: '请先登录携程内容中心' };
  try { return await withPage(session, page, verifyOnPage); }
  catch (error) { return failure(error); }
}

function draftInput(article, resolvedAssets = {}) {
  if (article?.metadata?.contentType !== 'imageText') {
    return { ok: false, code: 'CONTENT_UNSUPPORTED', message: '携程笔记当前只接入图文内容' };
  }
  const title = String(article.title || '').trim();
  const description = String(article.markdown || '').trim();
  const length = [...title].length;
  if (length < 5 || length > 30 || !description || description.length > 3000) {
    return { ok: false, code: 'INVALID', message: '携程图文需要 5–30 字标题和不超过 3000 字的描述' };
  }
  const assetIds = article.metadata.assetIds || [];
  if (!Array.isArray(assetIds) || assetIds.length < 1 || assetIds.length > 20) {
    return { ok: false, code: 'INVALID', message: '携程图文需要 1–20 张图片' };
  }
  const images = [];
  for (const id of assetIds) {
    const asset = resolvedAssets[id];
    const file = asset?.pathOrUrl;
    if (asset?.kind !== 'image' || !file || !path.isAbsolute(file) ||
        !/\.(jpe?g|png)$/i.test(file) || !fs.existsSync(file)) {
      return { ok: false, code: 'INVALID', message: '携程图片需使用本机素材库中的 JPG 或 PNG 文件' };
    }
    images.push(file);
  }
  return { ok: true, title, description, images };
}

async function showDrafts(page) {
  await page.getByText('草稿箱', { exact: false }).first().click();
  await page.waitForTimeout(500);
}

async function saveDraft({ session, article, resolvedAssets, page } = {}) {
  const input = draftInput(article, resolvedAssets);
  if (!input.ok) return input;
  if (!scopedSession(session).cookies.length) return { ok: false, code: 'AUTH', message: '请先登录携程内容中心' };
  let attempted = false;
  try {
    return await withPage(session, page, async tab => {
      const profile = await verifyOnPage(tab);
      if (!profile.ok) return profile;
      await showDrafts(tab);
      const oldTitles = await tab.locator('.c-m-c-container .top-title-bg .title').allTextContents();
      if (oldTitles.some(title => title.trim() === input.title)) {
        return { ok: false, code: 'DUPLICATE_TITLE', message: '携程草稿箱已有同名笔记，请使用可区分的标题后再试' };
      }
      await tab.goto(EDITOR, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await tab.locator('.publish-container .editor-body .public-DraftEditor-content').first().waitFor({ timeout: 15000 });
      if (new URL(tab.url()).pathname !== '/publish/publishPictureText') {
        return { ok: false, code: 'AUTH', message: '携程未进入图文编辑页' };
      }
      const fields = tab.locator('.publish-container .editor-body .public-DraftEditor-content');
      if (await fields.count() < 2) {
        return { ok: false, code: 'EDITOR_CHANGED', message: '携程图文编辑框已变化，需重新适配' };
      }
      await fields.nth(0).fill(input.title);
      await fields.nth(1).fill(input.description);
      const upload = tab.locator('.publish-container input[type="file"]').first();
      if (!await upload.count()) {
        return { ok: false, code: 'EDITOR_CHANGED', message: '携程图文图片上传入口已变化，需重新适配' };
      }
      await upload.setInputFiles(input.images);
      await tab.waitForFunction(expected => document.querySelectorAll('.r-d-upload-image-container-done').length >= expected,
        input.images.length, { timeout: 45000 });
      const save = tab.locator('.r-d-button-container button').filter({ hasText: '存草稿' });
      if (await save.count() !== 1) {
        return { ok: false, code: 'EDITOR_CHANGED', message: '携程草稿按钮已变化，需重新适配' };
      }
      attempted = true;
      await save.click();
      await tab.waitForURL(url => url.pathname === '/publish/contentManagement', { timeout: 30000 });
      await showDrafts(tab);
      await tab.waitForFunction(title => [...document.querySelectorAll('.c-m-c-container .top-title-bg .title')]
        .some(element => element.textContent.trim() === title), input.title, { timeout: 15000 });
      const matches = tab.locator('.c-m-c-container').filter({ has: tab.locator('.top-title-bg .title', { hasText: input.title }) });
      if (await matches.count() !== 1 || !/草稿/.test(await matches.first().locator('.publish-status').innerText())) {
        return { ok: false, code: 'NEEDS_REVIEW', message: '携程草稿箱出现同名或状态不明的记录，请人工核对' };
      }
      const edit = matches.first().locator('.edit').filter({ hasText: '编辑' });
      if (await edit.count() !== 1) {
        return { ok: false, code: 'NEEDS_REVIEW', message: '草稿已出现，但尚未取得平台草稿编号' };
      }
      await edit.click();
      await tab.waitForURL(url => url.pathname === '/publish/publishPictureText' && !!url.searchParams.get('articleId'),
        { timeout: 15000 });
      const current = new URL(tab.url());
      const remoteId = current.searchParams.get('articleId');
      if (!remoteId || current.searchParams.get('articleStatus') !== 'DRAFT') {
        return { ok: false, code: 'NEEDS_REVIEW', message: '草稿箱中未取得明确的草稿编号和状态' };
      }
      // Reopen the remote draft and compare all submitted fields. A toast and
      // an ID alone are insufficient evidence that the platform retained it.
      try {
        await tab.waitForFunction(({ title, description, imageCount }) => {
          const text = value => String(value || '').replace(/\s+/g, ' ').trim();
          const editors = document.querySelectorAll('.publish-container .editor-body .public-DraftEditor-content');
          return editors.length >= 2 && text(editors[0].textContent) === text(title) &&
            text(editors[1].textContent) === text(description) &&
            document.querySelectorAll('.r-d-upload-image-container-done').length === imageCount;
        }, { title: input.title, description: input.description, imageCount: input.images.length }, { timeout: 15000 });
      } catch {
        return { ok: false, code: 'NEEDS_REVIEW', message: '已找到携程草稿，但重新打开后的标题、描述或图片数量未核对一致' };
      }
      return { ok: true, remoteId };
    });
  } catch (error) { return failure(error, attempted); }
}

module.exports = {
  id: 'CtripNotes', name: '携程笔记',
  contentTypes: ['imageText'], draftTypes: ['imageText'], loginUrls,
  verifySession, saveDraft,
};
