import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"

const importedIntegrationModule = await import("../src/lib/agent/integration-catalog")
const integrationModule = (
  "default" in importedIntegrationModule
    ? importedIntegrationModule.default
    : importedIntegrationModule
) as typeof import("../src/lib/agent/integration-catalog")
const { AGENT_INTEGRATIONS, integrationConfig } = integrationModule

const testToken = "stgeo_agt_integration_test"
assert.equal(new Set(AGENT_INTEGRATIONS.map(item => item.key)).size, AGENT_INTEGRATIONS.length)
const codexConfig = integrationConfig("codex", testToken)
assert.match(codexConfig, /bearer_token_env_var = "SHITU_GEO_TOKEN"/)
assert.doesNotMatch(codexConfig, /http_headers = \{ Authorization/)
assert.doesNotMatch(codexConfig, new RegExp(testToken))
assert.match(integrationConfig("claude", testToken), /claude mcp add --transport http/)
assert.equal(JSON.parse(integrationConfig("cursor", testToken)).mcpServers["shitu-geo"].type, "http")
assert.match(integrationConfig("cli", testToken), /downloads\/shitu-geo\.mjs/)

assert.equal(
  await fs.readFile("public/downloads/shitu-geo.mjs", "utf8"),
  await fs.readFile("cli/shitu-geo.mjs", "utf8"),
  "公开下载的 CLI 必须与源文件一致",
)

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-agent-cli-"))
const server = http.createServer((request, response) => {
  if (request.url === "/api/agent/v1/capabilities" && request.headers.authorization === "Bearer cli-test-token") {
    response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify({ ok: true, data: { apiVersion: "v1", token: { id: "agt_cli" } }, meta: { traceId: "trace_cli" } }))
    return
  }
  response.statusCode = 401
  response.setHeader("Content-Type", "application/json")
  response.end(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED", message: "unauthorized", retryable: false }, meta: { traceId: "trace_cli" } }))
})

await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
if (!address || typeof address === "string") throw new Error("CLI test server failed")

function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["cli/shitu-geo.mjs", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, XDG_CONFIG_HOME: directory, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", chunk => { stdout += chunk })
    child.stderr.on("data", chunk => { stderr += chunk })
    child.on("error", reject)
    child.on("close", code => resolve({ code, stdout, stderr }))
  })
}

try {
  const baseUrl = `http://127.0.0.1:${address.port}`
  const configured = await run(["auth", "set", "--token", "cli-test-token", "--base-url", baseUrl])
  assert.equal(configured.code, 0, configured.stderr)
  const status = await run(["auth", "status", "--json"])
  assert.equal(status.code, 0, status.stderr)
  assert.equal(JSON.parse(status.stdout).apiVersion, "v1")
  const configFile = path.join(directory, "shitu-geo", "config.json")
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(configFile)).mode & 0o777, 0o600)
  }
  console.log("Agent CLI contract tests passed.")
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()))
  await fs.rm(directory, { recursive: true, force: true })
}
