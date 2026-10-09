const assert = require("node:assert/strict")
const path = require("node:path")
const { _electron: electron } = require("playwright")

async function waitForApplicationWindow(electronApp, origin) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    for (const page of electronApp.windows()) {
      if (page.url().startsWith(origin)) return page
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error("Web application window did not load")
}

async function waitForWindow(electronApp, title) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    for (const page of electronApp.windows()) {
      if (await page.title() === title) return page
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Window not found: ${title}`)
}

async function main() {
  const applicationUrl = process.env.SHITU_DESKTOP_TEST_URL
  if (!applicationUrl) throw new Error("SHITU_DESKTOP_TEST_URL is required")
  const desktopRoot = path.resolve(__dirname, "..")
  const origin = new URL(applicationUrl).origin
  const electronApp = await electron.launch({
    args: [desktopRoot],
    cwd: desktopRoot,
    env: {
      ...process.env,
      SHITU_DESKTOP_TEST_MODE: "1",
      SHITU_DESKTOP_URL: applicationUrl,
    },
  })

  try {
    const page = await waitForApplicationWindow(electronApp, origin)
    await page.waitForLoadState("domcontentloaded")
    assert.match(await page.title(), /势途 GEO/)
    assert.equal(await page.evaluate(() => window.shituDesktop?.isDesktop), true)
    const health = await page.evaluate(async () => {
      const response = await fetch("/api/desktop/health", { cache: "no-store" })
      return { status: response.status, body: await response.json() }
    })
    assert.equal(health.status, 200)
    assert.equal(health.body.status, "ok")

    await page.evaluate(() => window.shituDesktop.openDesktopCenter("network"))
    const center = await waitForWindow(electronApp, "势途 GEO 桌面中心")
    await center.waitForFunction(() => (
      document.querySelectorAll(".diagnostic-item").length === 3
      && document.querySelector("#run-diagnostics")?.disabled === false
    ))
    const values = await center.locator(".diagnostic-value").allTextContents()
    assert.deepEqual(values, ["解析正常", "检测完成", "连接正常"])
  } finally {
    await electronApp.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
