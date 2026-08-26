const path = require("node:path")
const { fileURLToPath } = require("node:url")

const DEFAULT_APP_URL = "https://shitugeo.top/"
const PRODUCTION_HOSTS = new Set(["shitugeo.top", "www.shitugeo.top"])
const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:", "tel:"])

function parseUrl(value, base) {
  try {
    return new URL(String(value || ""), base)
  } catch {
    return null
  }
}

function isLocalhost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
}

function normalizeAppUrl(value = DEFAULT_APP_URL, options = {}) {
  const target = parseUrl(value || DEFAULT_APP_URL)
  if (!target || target.username || target.password) {
    throw new Error("Invalid desktop application URL")
  }
  if (target.protocol === "https:" && PRODUCTION_HOSTS.has(target.hostname)) {
    return target.toString()
  }
  if (options.allowLocalhost && target.protocol === "http:" && isLocalhost(target.hostname)) {
    return target.toString()
  }
  if (options.allowFile && target.protocol === "file:") {
    return target.toString()
  }
  throw new Error("Desktop application URL is not trusted")
}

function isTrustedAppUrl(value, appUrl) {
  const target = parseUrl(value)
  const application = parseUrl(appUrl)
  if (!target || !application || target.username || target.password) return false

  if (application.protocol === "file:") {
    if (target.protocol !== "file:") return false
    const appDirectory = path.dirname(fileURLToPath(application))
    const targetPath = fileURLToPath(target)
    return targetPath === fileURLToPath(application) || targetPath.startsWith(`${appDirectory}${path.sep}`)
  }

  if (target.protocol === "blob:") {
    return target.origin === application.origin
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return false
  if (target.origin === application.origin) return true
  return application.protocol === "https:"
    && target.protocol === "https:"
    && PRODUCTION_HOSTS.has(application.hostname)
    && PRODUCTION_HOSTS.has(target.hostname)
  }

function isSafeExternalUrl(value) {
  const target = parseUrl(value)
  if (!target || !EXTERNAL_PROTOCOLS.has(target.protocol)) return false
  if ((target.protocol === "http:" || target.protocol === "https:") && (target.username || target.password)) {
    return false
  }
  return true
}

function safeInternalUrl(value, appUrl) {
  const target = parseUrl(value, appUrl)
  return target && isTrustedAppUrl(target.toString(), appUrl) ? target.toString() : undefined
}

function resolveDesktopDeepLink(value, appUrl) {
  const target = parseUrl(value)
  if (!target || target.protocol !== "shitugeo:") return undefined
  const requested = target.searchParams.get("path")
    || target.searchParams.get("url")
    || (target.hostname === "open" ? target.pathname : `/${target.hostname}${target.pathname}`)
  return safeInternalUrl(requested || "/", appUrl)
}

function limitText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, maxLength)
}

function sanitizeNotification(payload, appUrl) {
  if (!payload || typeof payload !== "object") return null
  const title = limitText(payload.title, 80)
  const body = limitText(payload.body, 240)
  if (!title || !body) return null
  return {
    id: limitText(payload.id, 160) || undefined,
    title,
    body,
    actionUrl: safeInternalUrl(payload.actionUrl, appUrl),
  }
}

function sanitizeFilename(value) {
  const cleaned = limitText(value, 180)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\.+$/g, "")
  return cleaned || "势途-GEO-下载文件"
}

module.exports = {
  DEFAULT_APP_URL,
  PRODUCTION_HOSTS,
  isSafeExternalUrl,
  isTrustedAppUrl,
  normalizeAppUrl,
  resolveDesktopDeepLink,
  safeInternalUrl,
  sanitizeFilename,
  sanitizeNotification,
}
