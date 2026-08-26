const fs = require("node:fs")
const path = require("node:path")

const NETWORK_MODES = new Set(["system", "direct"])
const DOWNLOAD_BEHAVIORS = new Set(["ask", "automatic"])

const DEFAULT_SETTINGS = Object.freeze({
  networkMode: "system",
  downloadBehavior: "ask",
})

function normalizeSettings(value) {
  return {
    networkMode: NETWORK_MODES.has(value?.networkMode) ? value.networkMode : DEFAULT_SETTINGS.networkMode,
    downloadBehavior: DOWNLOAD_BEHAVIORS.has(value?.downloadBehavior)
      ? value.downloadBehavior
      : DEFAULT_SETTINGS.downloadBehavior,
  }
}

function createSettingsStore(userDataPath) {
  const settingsPath = path.join(userDataPath, "desktop-settings.json")
  let current = { ...DEFAULT_SETTINGS }
  try {
    current = normalizeSettings(JSON.parse(fs.readFileSync(settingsPath, "utf8")))
  } catch {
    current = { ...DEFAULT_SETTINGS }
  }

  function persist() {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    const temporaryPath = `${settingsPath}.tmp`
    fs.writeFileSync(temporaryPath, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporaryPath, settingsPath)
  }

  return {
    get() {
      return { ...current }
    },
    update(patch) {
      current = normalizeSettings({ ...current, ...patch })
      persist()
      return { ...current }
    },
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  DOWNLOAD_BEHAVIORS,
  NETWORK_MODES,
  createSettingsStore,
  normalizeSettings,
}
