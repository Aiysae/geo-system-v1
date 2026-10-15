const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const { uniquePath } = require("../src/download-manager.cjs")
const { createSettingsStore, normalizeSettings } = require("../src/settings.cjs")

test("desktop settings reject unknown values", () => {
  assert.deepEqual(normalizeSettings({ networkMode: "proxy", downloadBehavior: "silent" }), {
    networkMode: "system",
    downloadBehavior: "ask",
  })
  assert.deepEqual(normalizeSettings({ networkMode: "direct", downloadBehavior: "automatic" }), {
    networkMode: "direct",
    downloadBehavior: "automatic",
  })
})

test("settings are persisted atomically in the desktop user directory", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shitu-desktop-settings-"))
  try {
    const first = createSettingsStore(directory)
    first.update({ networkMode: "direct", downloadBehavior: "automatic" })
    const second = createSettingsStore(directory)
    assert.deepEqual(second.get(), { networkMode: "direct", downloadBehavior: "automatic" })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test("automatic downloads never overwrite an existing file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shitu-desktop-download-"))
  try {
    fs.writeFileSync(path.join(directory, "report.pdf"), "existing")
    fs.writeFileSync(path.join(directory, "report-2.pdf"), "existing")
    assert.equal(uniquePath(directory, "report.pdf"), path.join(directory, "report-3.pdf"))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
