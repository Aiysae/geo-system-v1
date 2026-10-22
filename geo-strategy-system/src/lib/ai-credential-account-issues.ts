import "server-only"

import { kv } from "@/lib/kv"
import { sendSystemEmail } from "@/lib/auth-email"
import { listAiCredentialsPublic } from "@/lib/ai-credential-store"
import { listAiCredentialRouteHealth } from "@/lib/ai-credential-route-health"
import { MODEL_LABELS } from "@/lib/model-labels"
import { getAdminNotificationEmails } from "@/lib/recharge-notification-email"
import type { ModelKey } from "@/types"
import type { AiCredentialFailureClass, AiCredentialVendor } from "@/types/ai-credentials"

// Accounts that stopped for a reason only an admin can fix: unpaid balance,
// a dead key, a service not switched on. The router already routes around
// them; this makes them visible before a run, and daily by email.

export interface AiCredentialAccountIssue {
  vendor: AiCredentialVendor
  credentialId: string
  accountLabel: string
  failureClass: AiCredentialFailureClass
  reason: string
  detail?: string
  since?: string
}

const ISSUE_REASONS: Partial<Record<AiCredentialFailureClass, string>> = {
  billing: "欠费或额度用完",
  authentication: "API Key 无效或已失效",
  permission: "未开通所需服务",
  model_unavailable: "所选型号未开通或已下线",
}

export async function listAiCredentialAccountIssues(
  vendors?: AiCredentialVendor[],
): Promise<AiCredentialAccountIssue[]> {
  const credentials = (await listAiCredentialsPublic())
    .filter(credential => credential.enabled && (!vendors || vendors.includes(credential.vendor)))
  if (credentials.length === 0) return []
  const routes = await listAiCredentialRouteHealth(credentials.map(credential => credential.id))
  const issues: AiCredentialAccountIssue[] = []
  for (const credential of credentials) {
    const route = routes.find(item => (
      item.credentialId === credential.id
      && item.state === "action_required"
      && ISSUE_REASONS[item.failureClass]
    ))
    if (!route) continue
    issues.push({
      vendor: credential.vendor,
      credentialId: credential.id,
      accountLabel: credential.accountLabel.replace(/\s*API\s*key\s*$/i, "").trim() || credential.name,
      failureClass: route.failureClass,
      reason: ISSUE_REASONS[route.failureClass]!,
      detail: String(route.lastErrorMessage || "").replace(/\s+/g, " ").trim().slice(0, 120) || undefined,
      since: route.lastFailureAt,
    })
  }
  return issues
}

function vendorLabel(vendor: AiCredentialVendor): string {
  return MODEL_LABELS[vendor as ModelKey] || vendor
}

// ---------------------------------------------------------------------------
// Daily digest
// ---------------------------------------------------------------------------

const DIGEST_HOUR_BEIJING = 9
const KEY_SENT = (day: string) => `admin_notifications:ai-accounts:sent:${day}`
const KEY_LOCK = (day: string) => `admin_notifications:ai-accounts:lock:${day}`

function beijingClock(now: Date): { day: string; hour: number } {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return { day: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] || char
  ))
}

/**
 * Emails the admins once a day, after 9:00 Beijing time, when any model
 * account needs attention. Several processes may call it; a lock and a
 * per-day marker keep it to one email.
 */
export async function sendDailyAccountIssueDigest(now = new Date()): Promise<"sent" | "none" | "skipped"> {
  if (/^(0|false|off|no)$/i.test(String(process.env.AI_ACCOUNT_DAILY_DIGEST_ENABLED || "true"))) {
    return "skipped"
  }
  const { day, hour } = beijingClock(now)
  if (hour < DIGEST_HOUR_BEIJING) return "skipped"
  if (await kv.get(KEY_SENT(day))) return "skipped"
  const locked = await kv.set(KEY_LOCK(day), String(now.getTime()), { nx: true, ex: 600 })
  if (!locked) return "skipped"

  const issues = await listAiCredentialAccountIssues()
  if (issues.length === 0) {
    await kv.set(KEY_SENT(day), "none", { ex: 3 * 24 * 60 * 60 })
    return "none"
  }
  const recipients = getAdminNotificationEmails()
  if (recipients.length === 0) {
    console.warn("[ai-account-digest] ADMIN_NOTIFICATION_EMAILS 或 ADMIN_EMAILS 未配置，跳过账号提醒")
    await kv.set(KEY_SENT(day), "no-recipients", { ex: 3 * 24 * 60 * 60 })
    return "skipped"
  }

  const lines = issues.map(issue => (
    `${vendorLabel(issue.vendor)} ${issue.accountLabel}：${issue.reason}${issue.detail ? `（${issue.detail}）` : ""}`
  ))
  const text = [
    `今天有 ${issues.length} 个模型账号需要处理，疑问句检测已自动绕开它们，但这些模型会变慢或无法检测：`,
    "",
    ...lines.map(line => `· ${line}`),
    "",
    "处理（充值、开通后付费或更换 Key）后，在后台模型账号点击复检即可恢复。",
  ].join("\n")
  const html = `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#f2f7fd;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#12233f;"><div style="max-width:620px;margin:0 auto;padding:32px 16px;"><div style="border:1px solid #d8e7f7;border-radius:12px;background:#fff;padding:28px 30px;"><div style="font-size:14px;font-weight:800;color:#1677ff;">势途 GEO</div><h1 style="margin:12px 0 10px;font-size:21px;color:#071a38;">${issues.length} 个模型账号需要处理</h1><p style="margin:0 0 14px;font-size:14px;line-height:1.8;color:#60708a;">疑问句检测已自动绕开这些账号，但对应模型会变慢或无法检测。</p><ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.9;">${lines.map(line => `<li>${escapeHtml(line)}</li>`).join("")}</ul><p style="margin:16px 0 0;font-size:13px;line-height:1.8;color:#60708a;">处理（充值、开通后付费或更换 Key）后，在后台模型账号点击复检即可恢复。</p></div></div></body></html>`
  try {
    await sendSystemEmail({
      to: recipients,
      subject: `【模型账号】${issues.length} 个账号需要处理`,
      text,
      html,
    })
  } catch (error) {
    // Leave the day unmarked so the next sweep tries again.
    await kv.del(KEY_LOCK(day))
    throw error
  }
  await kv.set(KEY_SENT(day), "sent", { ex: 3 * 24 * 60 * 60 })
  return "sent"
}
