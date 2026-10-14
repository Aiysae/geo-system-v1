import { spawnSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

const cwd = fileURLToPath(new URL("../", import.meta.url))
const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const files = readdirSync(new URL("./", import.meta.url))
  .filter(file => /^test-.*\.(?:mts|mjs|ts|js)$/.test(file)).sort()
const failures = []
const skipped = []
let passed = 0

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
  const result = spawnSync(process.execPath, [process.env.npm_execpath, "run", name], {
    cwd,
    stdio: "inherit",
  })
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
