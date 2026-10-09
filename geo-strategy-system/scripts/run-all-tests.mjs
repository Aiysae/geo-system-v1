import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const cwd = fileURLToPath(new URL("../", import.meta.url))
const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const files = readdirSync(new URL("./", import.meta.url))
  .filter(file => /^test-.*\.(?:mts|mjs|ts|js)$/.test(file)).sort()
const failures = []
const skipped = []
let passed = 0

// File-backed stores default to the project's .data directory. Point every
// one of them at a fresh temporary directory per test so a test that forgets
// to isolate a store cannot read or overwrite the developer's local data.
// Tests that configure their own paths still override these defaults.
const STORE_FILES = {
  LOCAL_KV_FILE: "kv.json",
  WORKSPACE_FILE: "workspaces.json",
  WORKSPACE_FILE_PATH: "workspaces.json",
  TEAM_FILE: "teams.json",
  AGENT_FILE: "agents.json",
  SYSTEM_OUTPUT_FILE: "system-outputs.json",
  PUBLISHING_PLAN_FILE: "publishing-plans.json",
  CONTENT_PRODUCTION_FILE: "content-production-runs.json",
  PENETRATION_HISTORY_FILE: "penetration-history.json",
  PENETRATION_AUTOMATION_FILE: "penetration-automations.json",
  CLIENT_FEEDBACK_AUTOMATION_FILE: "client-feedback-automations.json",
  REPORTS_DIR: "reports",
  ARTICLE_ARTIFACTS_DIR: "article-artifacts",
  ARTICLE_MEDIA_ASSETS_DIR: "article-media",
  KNOWLEDGE_IMPORT_FILES_DIR: "knowledge-imports",
}

function isolatedStoreEnv(directory) {
  const env = { ...process.env }
  for (const [name, file] of Object.entries(STORE_FILES)) {
    if (!env[name]) env[name] = path.join(directory, file)
  }
  return env
}

for (const file of files) {
  // This browser test requires a running app and Playwright Chromium. Set the
  // URL explicitly so npm test never targets an unrelated local development app.
  if (file === "test-desktop-download-ui.mjs" && !process.env.SHITU_UI_TEST_URL) {
    const reason = `${file}: requires a running app (SHITU_UI_TEST_URL) and Playwright Chromium`
    skipped.push(reason)
    console.log(`[SKIP] ${reason}`)
    continue
  }
  const commands = Object.entries(scripts)
    .filter(([, command]) => command.split(/\s+/).includes(`scripts/${file}`))
  if (commands.length !== 1) {
    const reason = `${file}: expected one package.json command, found ${commands.length}`
    failures.push(reason)
    console.error(`[FAIL] ${reason}`)
    continue
  }
  const [name] = commands[0]
  console.log(`\n[RUN] ${file} (${name})`)
  const storeDirectory = mkdtempSync(path.join(tmpdir(), "geo-test-stores-"))
  const result = spawnSync(process.execPath, [process.env.npm_execpath, "run", name], {
    cwd,
    stdio: "inherit",
    env: isolatedStoreEnv(storeDirectory),
  })
  rmSync(storeDirectory, { recursive: true, force: true })
  if (result.status === 0 && !result.error) {
    passed++
    console.log(`[PASS] ${file}`)
  } else {
    const reason = `${file}: ${result.error?.message || result.signal || `exit ${result.status}`}`
    failures.push(reason)
    console.error(`[FAIL] ${reason}`)
  }
}

console.log(`\nTests: ${files.length}; passed: ${passed}; failed: ${failures.length}; skipped: ${skipped.length}`)
for (const failure of failures) console.error(`[FAIL] ${failure}`)
for (const skip of skipped) console.log(`[SKIP] ${skip}`)
if (files.length === 0) console.error("No test scripts found.")
process.exitCode = failures.length > 0 || files.length === 0 ? 1 : 0
