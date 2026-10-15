const assert = require("node:assert/strict")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const { _electron: electron } = require("playwright")

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
  const desktopRoot = path.resolve(__dirname, "..")
  const fixtureUrl = pathToFileURL(path.join(__dirname, "fixtures", "app.html")).toString()
  const electronApp = await electron.launch({
    args: [desktopRoot],
    cwd: desktopRoot,
    env: {
      ...process.env,
      SHITU_DESKTOP_TEST_MODE: "1",
      SHITU_DESKTOP_URL: fixtureUrl,
    },
  })

  try {
    const page = await waitForWindow(electronApp, "势途 GEO Desktop Fixture")
    await page.waitForFunction(() => document.querySelector("#runtime")?.textContent?.includes("势途 GEO"))
    const runtime = await page.evaluate(async () => ({
      isDesktop: window.shituDesktop?.isDesktop,
      info: await window.shituDesktop?.getInfo(),
    }))
    assert.equal(runtime.isDesktop, true)
    assert.equal(runtime.info.name, "势途 GEO")
    assert.equal(runtime.info.networkMode, "system")

    await page.evaluate(() => window.shituDesktop.openDesktopCenter("network"))
    const center = await waitForWindow(electronApp, "势途 GEO 桌面中心")
    await center.waitForFunction(() => (
      document.querySelectorAll(".diagnostic-item").length === 3
      && document.querySelector("#run-diagnostics")?.disabled === false
    ))
    const diagnostics = await center.evaluate(() => window.shituDesktopCenter.diagnoseNetwork())
    assert.equal(diagnostics.service.ok, true)
    assert.equal(diagnostics.dns.ok, true)
    assert.equal(diagnostics.proxy.value, "DIRECT")
  } finally {
    await electronApp.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
