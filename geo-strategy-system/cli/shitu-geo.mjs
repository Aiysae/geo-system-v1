#!/usr/bin/env node

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"

const TERMINAL = new Set(["succeeded", "partial", "failed", "cancelled", "blocked"])

function configPath() {
  const base = process.platform === "win32"
    ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(base, "shitu-geo", "config.json")
}

async function readConfig() {
  try {
    return JSON.parse(await fs.readFile(configPath(), "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") return {}
    throw error
  }
}

async function writeConfig(value) {
  const file = configPath()
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await fs.rename(temporary, file)
  if (process.platform !== "win32") await fs.chmod(file, 0o600)
}

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith("--")) {
      positional.push(value)
      continue
    }
    const [rawKey, inline] = value.slice(2).split("=", 2)
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    if (inline !== undefined) flags[key] = inline
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) flags[key] = argv[++index]
    else flags[key] = true
  }
  return { positional, flags }
}

function cleanBaseUrl(value) {
  const normalized = String(value || "https://shitugeo.top").trim().replace(/\/+$/, "")
  const url = new URL(normalized)
  if (!/^https?:$/.test(url.protocol)) throw new Error("base URL 必须使用 http 或 https")
  return normalized
}

async function credentials(flags = {}) {
  const config = await readConfig()
  const token = String(flags.token || process.env.SHITU_GEO_TOKEN || config.token || "").trim()
  const baseUrl = cleanBaseUrl(flags.baseUrl || process.env.SHITU_GEO_BASE_URL || config.baseUrl)
  if (!token) throw new Error("缺少 Agent Token。请设置 SHITU_GEO_TOKEN，或运行 shitu-geo auth set --token <token>")
  return { token, baseUrl }
}

function queryString(input) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "" || value === false) continue
    params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ""
}

async function apiRequest(apiPath, options = {}) {
  const auth = await credentials(options.flags)
  const response = await fetch(`${auth.baseUrl}/api/agent/v1${apiPath}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: options.binary
        ? options.accept || "application/pdf, application/zip, application/octet-stream"
        : "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.requestId ? { "X-Request-Id": options.requestId } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (options.binary && response.ok) return { response, data: new Uint8Array(await response.arrayBuffer()) }
  const body = await response.json().catch(async () => ({
    ok: false,
    error: { code: "INVALID_RESPONSE", message: (await response.text()).slice(0, 1_000), retryable: false },
  }))
  if (!response.ok || body?.ok === false) {
    const error = new Error(body?.error?.message || `HTTP ${response.status}`)
    error.code = body?.error?.code || `HTTP_${response.status}`
    error.retryable = body?.error?.retryable === true
    error.traceId = body?.meta?.traceId
    throw error
  }
  return { response, data: body?.data ?? body, meta: body?.meta }
}

function print(value, flags = {}) {
  if (flags.json || typeof value !== "string") console.log(JSON.stringify(value, null, 2))
  else console.log(value)
}

async function readPayload(file) {
  const raw = !file || file === "-"
    ? await new Promise((resolve, reject) => {
        let value = ""
        process.stdin.setEncoding("utf8")
        process.stdin.on("data", chunk => { value += chunk })
        process.stdin.on("end", () => resolve(value))
        process.stdin.on("error", reject)
      })
    : await fs.readFile(path.resolve(file), "utf8")
  const payload = JSON.parse(raw)
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("动作输入必须是 JSON 对象")
  return payload
}

function help() {
  return `势途 GEO CLI

用法：shitu-geo <命令> [参数]

认证
  auth set --token <token> [--base-url https://shitugeo.top]
  auth status

客户与任务
  clients list
  clients get <clientId> [--team-id id] [--sections core,penetration]
  tasks list [--client-id id] [--team-id id] [--status running]
  tasks get <taskId>
  tasks result <taskId>
  tasks restore <taskId>
  tasks watch <taskId> [--interval 2000] [--timeout 1800000]  # 无进度时自动降低轮询频率
  tasks cancel <taskId>

产出与报告
  outputs list --client-id id --module penetration [--team-id id]
  outputs get <outputId> [--team-id id]
  reports list --client-id id [--team-id id]
  reports create --file payload.json
  reports download <jobId> --out report.pdf
  articles list --client-id id [--team-id id]
  articles get <batchId>
  articles settings
  articles download <batchId> [--scope passed|all|direct] [--variant original|media] --out articles.zip
  feedback get <clientId> [--team-id id]
  knowledge list --client-id id [--team-id id]
  knowledge get <importId> --client-id id [--team-id id]

执行
  actions run <action> --file payload.json [--dry-run]
  penetration questions --file payload.json [--dry-run]
  automation get|save|status|run|delete --file payload.json [--dry-run]
  research run|compare --file payload.json [--dry-run]
  diagnosis run --file payload.json [--dry-run]
  keywords extract|advantages|strategy|website-prompt|questions --file payload.json [--dry-run]
  articles generate|rewrite|batch|plan|extract|analyze-brands --file payload.json [--dry-run]
  articles materials-list|materials-import|materials-delete --file payload.json [--dry-run]
  articles media-upload|media-run --file payload.json [--dry-run]
  feedback action|import|report|report-options|report-manage|profile|visibility --file payload.json [--dry-run]
  knowledge import|commit --file payload.json [--dry-run]
  capabilities

所有命令均支持 --json、--base-url 和 --token；生产环境更建议使用 SHITU_GEO_TOKEN。`
}

const ACTION_COMMANDS = new Map([
  ["research:run", "research.run"],
  ["research:compare", "research.compare"],
  ["diagnosis:run", "diagnosis.run"],
  ["penetration:questions", "penetration.questions.generate"],
  ["automation:get", "penetration.automation.get"],
  ["automation:save", "penetration.automation.save"],
  ["automation:status", "penetration.automation.set-status"],
  ["automation:run", "penetration.automation.run"],
  ["automation:delete", "penetration.automation.delete"],
  ["keywords:extract", "keyword.extract"],
  ["keywords:advantages", "keyword.advantages"],
  ["keywords:strategy", "keyword.strategy.run"],
  ["keywords:website-prompt", "keyword.website-prompt.run"],
  ["keywords:questions", "keyword.questions.run"],
  ["articles:generate", "article.generate"],
  ["articles:rewrite", "article.rewrite"],
  ["articles:batch", "article.batch.run"],
  ["articles:plan", "article.strategy.plan"],
  ["articles:extract", "article.source.extract"],
  ["articles:analyze-brands", "article.brands.analyze"],
  ["articles:materials-list", "article.materials.list"],
  ["articles:materials-import", "article.materials.import"],
  ["articles:materials-delete", "article.materials.delete"],
  ["articles:media-upload", "article.media.upload"],
  ["articles:media-run", "article.media.run"],
  ["feedback:action", "feedback.action.create"],
  ["feedback:import", "feedback.actions.import"],
  ["feedback:report", "feedback.report.create"],
  ["feedback:report-options", "feedback.report.options"],
  ["feedback:report-manage", "feedback.report.manage"],
  ["feedback:profile", "feedback.profile.update"],
  ["feedback:visibility", "feedback.visibility.update"],
  ["knowledge:import", "knowledge.import"],
  ["knowledge:commit", "knowledge.commit"],
  ["reports:create", "report.create"],
])

async function runAction(action, flags) {
  const payload = await readPayload(flags.file)
  if (flags.dryRun) payload.dryRun = true
  const result = await apiRequest(`/actions/${encodeURIComponent(action)}`, {
    method: "POST",
    body: payload,
    requestId: payload.requestId,
    flags,
  })
  return print(result.data, flags)
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const [group, command, id] = positional
  if (!group || group === "help" || flags.help) return print(help(), flags)

  if (group === "auth" && command === "set") {
    const current = await readConfig()
    const token = String(flags.token || process.env.SHITU_GEO_TOKEN || "").trim()
    if (!token) throw new Error("请通过 --token 或 SHITU_GEO_TOKEN 提供密钥")
    const baseUrl = cleanBaseUrl(flags.baseUrl || current.baseUrl)
    await writeConfig({ token, baseUrl })
    return print(`已保存到 ${configPath()}`, flags)
  }
  if (group === "auth" && command === "status") {
    const result = await apiRequest("/capabilities", { flags })
    return print(result.data, flags)
  }
  if (group === "capabilities") {
    const result = await apiRequest("/capabilities", { flags })
    return print(result.data, flags)
  }
  if (group === "clients" && command === "list") {
    const result = await apiRequest("/clients", { flags })
    return print(result.data, flags)
  }
  if (group === "clients" && command === "get" && id) {
    const query = queryString({ teamId: flags.teamId, sections: flags.sections })
    const result = await apiRequest(`/clients/${encodeURIComponent(id)}${query}`, { flags })
    return print(result.data, flags)
  }
  if (group === "tasks" && command === "list") {
    const query = queryString({ limit: flags.limit, cursor: flags.cursor, clientId: flags.clientId, teamId: flags.teamId, status: flags.status })
    const result = await apiRequest(`/tasks${query}`, { flags })
    return print(result.data, flags)
  }
  if (group === "tasks" && command === "get" && id) {
    const result = await apiRequest(`/tasks/${encodeURIComponent(id)}`, { flags })
    return print(result.data, flags)
  }
  if (group === "tasks" && command === "result" && id) {
    const result = await apiRequest(`/tasks/${encodeURIComponent(id)}/result`, { flags })
    return print(result.data, flags)
  }
  if (group === "tasks" && command === "restore" && id) {
    const result = await apiRequest(`/tasks/${encodeURIComponent(id)}/restore`, { method: "POST", flags })
    return print(result.data, flags)
  }
  if (group === "tasks" && command === "cancel" && id) {
    const result = await apiRequest(`/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST", flags })
    return print(result.data, flags)
  }
  if (group === "tasks" && command === "watch" && id) {
    const interval = Math.max(500, Number(flags.interval) || 2_000)
    const timeout = Math.max(interval, Number(flags.timeout) || 30 * 60 * 1_000)
    const started = Date.now()
    let previous = ""
    let waitMs = interval
    while (Date.now() - started < timeout) {
      const result = await apiRequest(`/tasks/${encodeURIComponent(id)}`, { flags })
      const task = result.data
      const fingerprint = `${task.status}:${task.progressPercent}:${task.stage}`
      if (fingerprint !== previous) {
        if (!flags.json) console.log(`[${task.status}] ${task.progressPercent}% ${task.stage || ""}`.trim())
        previous = fingerprint
        waitMs = interval
      } else {
        waitMs = Math.min(10_000, Math.ceil(waitMs * 1.35))
      }
      if (TERMINAL.has(task.status)) return print(task, flags)
      const jitter = Math.floor(Math.random() * Math.min(250, Math.max(1, Math.floor(waitMs / 10))))
      await new Promise(resolve => setTimeout(resolve, waitMs + jitter))
    }
    throw new Error("等待任务完成超时；任务仍在后台运行，可稍后再次 watch")
  }
  if (group === "outputs" && command === "list") {
    const query = queryString({ clientId: flags.clientId, teamId: flags.teamId, module: flags.module, page: flags.page, pageSize: flags.pageSize, days: flags.days, status: flags.status })
    const result = await apiRequest(`/outputs${query}`, { flags })
    return print(result.data, flags)
  }
  if (group === "outputs" && command === "get" && id) {
    const result = await apiRequest(`/outputs/${encodeURIComponent(id)}${queryString({ teamId: flags.teamId })}`, { flags })
    return print(result.data, flags)
  }
  if (group === "reports" && command === "list") {
    const query = queryString({ clientId: flags.clientId, teamId: flags.teamId, kind: flags.kind, status: flags.status, days: flags.days })
    const result = await apiRequest(`/reports${query}`, { flags })
    return print(result.data, flags)
  }
  if (group === "reports" && command === "download" && id) {
    const target = path.resolve(String(flags.out || `geo-report-${id}.pdf`))
    const result = await apiRequest(`/reports/${encodeURIComponent(id)}/download`, { flags, binary: true })
    await fs.writeFile(target, result.data)
    return print(target, flags)
  }
  if (group === "articles" && command === "list") {
    const query = queryString({ clientId: flags.clientId, teamId: flags.teamId })
    const result = await apiRequest(`/articles/batches${query}`, { flags })
    return print(result.data, flags)
  }
  if (group === "articles" && command === "get" && id) {
    const result = await apiRequest(`/articles/batches/${encodeURIComponent(id)}`, { flags })
    return print(result.data, flags)
  }
  if (group === "articles" && command === "settings") {
    const result = await apiRequest("/articles/settings", { flags })
    return print(result.data, flags)
  }
  if (group === "articles" && command === "download" && id) {
    const scope = flags.scope === "all" || flags.scope === "direct" ? flags.scope : "passed"
    const variant = flags.variant === "media" ? "media" : "original"
    const target = path.resolve(String(flags.out || `geo-articles-${id}-${scope}-${variant}.zip`))
    const query = queryString({ scope, variant })
    const result = await apiRequest(`/articles/batches/${encodeURIComponent(id)}/download${query}`, {
      flags,
      binary: true,
      accept: "application/zip, application/octet-stream",
    })
    await fs.writeFile(target, result.data)
    return print(target, flags)
  }
  if (group === "feedback" && command === "get" && id) {
    const result = await apiRequest(`/feedback/${encodeURIComponent(id)}${queryString({ teamId: flags.teamId })}`, { flags })
    return print(result.data, flags)
  }
  if (group === "knowledge" && command === "list") {
    const query = queryString({ clientId: flags.clientId, teamId: flags.teamId })
    const result = await apiRequest(`/knowledge/imports${query}`, { flags })
    return print(result.data, flags)
  }
  if (group === "knowledge" && command === "get" && id) {
    const query = queryString({ clientId: flags.clientId, teamId: flags.teamId })
    const result = await apiRequest(`/knowledge/imports/${encodeURIComponent(id)}${query}`, { flags })
    return print(result.data, flags)
  }
  if (group === "actions" && command === "run" && id) {
    return runAction(id, flags)
  }
  const dedicatedAction = ACTION_COMMANDS.get(`${group}:${command}`)
  if (dedicatedAction) return runAction(dedicatedAction, flags)
  throw new Error(`无法识别命令。\n\n${help()}`)
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: error?.code || "CLI_ERROR",
      message: error instanceof Error ? error.message : String(error),
      retryable: error?.retryable === true,
      traceId: error?.traceId,
    },
  }, null, 2))
  process.exitCode = 1
})
