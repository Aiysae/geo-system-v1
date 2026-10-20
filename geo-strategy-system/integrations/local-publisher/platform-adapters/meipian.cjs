const fs = require('node:fs');
const path = require('node:path');
const localBrowsers = path.join(process.cwd(), '.data/local-publishing-browsers');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(localBrowsers)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;
}
const { chromium } = require('playwright');

const loginUrls = {
  authorizeUrl: 'https://www.meipian.cn/officialWebsiteLogin',
  entryUrl: 'https://www.meipian.cn/mine',
};

// The current Meipian editor stores ordinary drafts in the local browser.
// Cloud drafts are a membership feature. Neither is safe to enqueue as a
// durable platform draft until an account can be tested and read back.
const adapter = {
  id: 'Meipian',
  name: '美篇',
  contentTypes: ['article'],
  draftTypes: [],
  loginUrls,
  verifySession,
  saveDraft,
};

function normalizeIdentity(view) {
  if (!view?.loggedIn) return { ok: false, code: 'AUTH', message: '请先在美篇完成登录' };
  const id = String(view.id || '').trim();
  const name = String(view.name || '').trim();
  if (!id || !name) {
    return { ok: false, code: 'IDENTITY_UNVERIFIED', message: '美篇已显示登录状态，但尚未通过在线账号核验' };
  }
  return { ok: true, identity: { id, name } };
}

async function launchBrowser() {
  const configured = process.env.LOCAL_PUBLISHER_BROWSER;
  const candidates = [configured, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    .filter(Boolean);
  const executablePath = candidates.find(file => fs.existsSync(file));
  if (!executablePath) throw new Error('本机缺少可用浏览器');
  return chromium.launch({ headless: true, executablePath });
}

async function verifySession({ session, browserFactory = launchBrowser }) {
  if (!session || !Array.isArray(session.cookies) || !Array.isArray(session.origins)) {
    return { ok: false, code: 'AUTH', message: '尚未取得美篇登录状态' };
  }
  let browser;
  let context;
  try {
    browser = await browserFactory();
    context = await browser.newContext({
      viewport: { width: 1200, height: 800 },
      storageState: { cookies: session.cookies, origins: session.origins },
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    if (session.sessionStorage) {
      await context.addInitScript(data => {
        const values = data[location.origin];
        if (values) for (const [key, value] of Object.entries(values)) sessionStorage.setItem(key, value);
      }, session.sessionStorage);
    }
    await context.route('**/*', async route => {
      const host = new URL(route.request().url()).hostname;
      if (/(^|\.)yixiaoer\.cn$/i.test(host)
        || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::|\[?f[cd])/i.test(host)) {
        await route.abort();
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    await page.goto(loginUrls.authorizeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => {
      return !!document.querySelector('.has-login .user-name, .wechat-login, .login-btn');
    }, undefined, { timeout: 10000 }).catch(() => {});
    const view = await page.evaluate(async () => {
      const display = document.querySelector('.has-login .user-name');
      if (!display) return { loggedIn: false };
      const app = document.querySelector('#app');
      const nodes = app ? [app, ...app.querySelectorAll('*')].slice(0, 200) : [];
      for (const node of nodes) {
        const store = node.__vue__?.$store;
        if (!store) continue;
        // The official web client action calls user.getInfo() remotely and
        // returns undefined when the online identity request fails.
        const info = await store.dispatch('utils/actionGetUserInfo').catch(() => null);
        if (info?.id && info?.nickname) return { loggedIn: true, id: info.id, name: info.nickname };
        break;
      }
      return { loggedIn: true };
    });
    return normalizeIdentity(view);
  } catch (error) {
    return { ok: false, code: 'PROFILE_UNAVAILABLE', message: `美篇账号核验暂时失败：${String(error.message || '页面未加载').slice(0, 90)}` };
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

async function saveDraft() {
  return {
    ok: false,
    code: 'DRAFT_UNVERIFIED',
    message: '美篇普通草稿仅保存在浏览器本地；云端草稿需要会员账号。完成账号登录和草稿回读验证前，暂不向平台提交。',
  };
}

module.exports = { ...adapter, normalizeIdentity };
