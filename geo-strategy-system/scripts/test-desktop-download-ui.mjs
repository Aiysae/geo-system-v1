import assert from "node:assert/strict"
import { chromium } from "@playwright/test"

const baseUrl = process.env.SHITU_UI_TEST_URL || "http://127.0.0.1:3000"
const browser = await chromium.launch({ headless: true })

async function verifyDesktop() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(baseUrl, { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "下载桌面端", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "下载势途 GEO 桌面端" })
  await dialog.waitFor()
  assert.equal(await dialog.locator('a[href="/api/desktop/download/windows"]').count(), 1)
  assert.equal(await dialog.locator('a[href="/api/desktop/download/mac"]').count(), 1)
  await page.screenshot({ path: "/tmp/shitu-desktop-download-desktop.png", fullPage: false })
  await page.close()
}

async function verifyMobile() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(baseUrl, { waitUntil: "networkidle" })
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  assert.ok(horizontalOverflow <= 1, `mobile page overflows horizontally by ${horizontalOverflow}px`)

  await page.locator('header nav button[title="下载桌面端"]').click()
  const dialog = page.getByRole("dialog", { name: "下载势途 GEO 桌面端" })
  await dialog.waitFor()
  const box = await dialog.boundingBox()
  assert.ok(
    box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 391 && box.y + box.height <= 845,
    `mobile dialog is outside the viewport: ${JSON.stringify(box)}`,
  )
  await page.screenshot({ path: "/tmp/shitu-desktop-download-mobile.png", fullPage: false })
  await page.close()
}

try {
  await verifyDesktop()
  await verifyMobile()
  console.log("Desktop download entry UI verified on desktop and mobile viewports.")
} finally {
  await browser.close()
}
