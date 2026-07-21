import "server-only"

import { kv } from "@/lib/kv"
import { sendSystemEmail } from "@/lib/auth-email"
import type { RechargeRequest } from "@/lib/recharge"

type DeliveryState = {
  status: "queued" | "sent" | "failed"
  attempts: number
  updatedAt: number
  nextAttemptAt?: number
  sentAt?: number
  error?: string
}

const MAX_ATTEMPTS = 6
const RETRY_DELAYS_MS = [
  0,
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  12 * 60 * 60_000,
]
const KEY_DELIVERY = (requestId: string) =>
  `admin_notifications:recharge:email:${requestId}`
const KEY_LOCK = (requestId: string) =>
  `admin_notifications:recharge:email-lock:${requestId}`

export function getAdminNotificationEmails(): string[] {
  const configured = String(
    process.env.ADMIN_NOTIFICATION_EMAILS || process.env.ADMIN_EMAILS || "",
  )
  return Array.from(new Set(configured
    .split(",")
    .map(email => email.trim().toLowerCase())
    .filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))))
}

export async function queueRechargeAdminEmail(requestId: string): Promise<void> {
  const now = Date.now()
  await kv.set(KEY_DELIVERY(requestId), {
    status: "queued",
    attempts: 0,
    updatedAt: now,
    nextAttemptAt: now,
  } satisfies DeliveryState, { nx: true })
}

export async function deliverRechargeAdminEmail(
  request: RechargeRequest,
): Promise<void> {
  const now = Date.now()
  const current = await kv.get<DeliveryState>(KEY_DELIVERY(request.id)) || {
    status: "queued" as const,
    attempts: 0,
    updatedAt: now,
    nextAttemptAt: now,
  }
  if (current.status === "sent" || current.attempts >= MAX_ATTEMPTS) return
  if ((current.nextAttemptAt || 0) > now) return

  const locked = await kv.set(KEY_LOCK(request.id), String(now), {
    nx: true,
    ex: 120,
  })
  if (!locked) return

  const attempts = current.attempts + 1
  try {
    const recipients = getAdminNotificationEmails()
    if (recipients.length === 0) {
      throw new Error("ADMIN_NOTIFICATION_EMAILS 或 ADMIN_EMAILS 未配置")
    }
    const amount = typeof request.priceCents === "number"
      ? `¥${(request.priceCents / 100).toFixed(2)}`
      : "金额待核对"
    const paymentMethod = paymentMethodLabel(request.paymentMethod)
    const reviewUrl = buildReviewUrl(request.id)
    const subject = `【待审批】新的积分充值申请 · ${amount}`
    const text = buildPlainText(request, amount, paymentMethod, reviewUrl)

    await sendSystemEmail({
      to: recipients,
      subject,
      text,
      html: renderRechargeEmail({ request, amount, paymentMethod, reviewUrl }),
    })
    const sentAt = Date.now()
    await kv.set(KEY_DELIVERY(request.id), {
      status: "sent",
      attempts,
      updatedAt: sentAt,
      sentAt,
    } satisfies DeliveryState)
  } catch (error) {
    const failedAt = Date.now()
    const delay = RETRY_DELAYS_MS[
      Math.min(attempts, RETRY_DELAYS_MS.length - 1)
    ] || 0
    await kv.set(KEY_DELIVERY(request.id), {
      status: "failed",
      attempts,
      updatedAt: failedAt,
      nextAttemptAt: failedAt + delay,
      error: error instanceof Error ? error.message.slice(0, 300) : "邮件发送失败",
    } satisfies DeliveryState)
    console.error(`[recharge-notification] Email delivery failed for ${request.id}`)
  } finally {
    await kv.del(KEY_LOCK(request.id))
  }
}

function paymentMethodLabel(method: RechargeRequest["paymentMethod"]): string {
  return {
    manual_transfer: "银行或人工转账",
    wechat: "微信支付",
    alipay: "支付宝",
    other: "其他方式",
  }[method || "manual_transfer"]
}

function applicationBaseUrl(): string {
  return String(
    process.env.APP_BASE_URL
      || process.env.NEXT_PUBLIC_APP_URL
      || "https://shitugeo.top",
  ).trim().replace(/\/$/, "")
}

function buildReviewUrl(requestId: string): string {
  return `${applicationBaseUrl()}/admin/recharge#recharge-${encodeURIComponent(requestId)}`
}

function buildPlainText(
  request: RechargeRequest,
  amount: string,
  paymentMethod: string,
  reviewUrl: string,
): string {
  return [
    "收到一笔新的积分充值申请，请登录管理后台核对。",
    `用户：${request.username || "未填写昵称"}（${request.email || "未填写邮箱"}）`,
    `套餐：${request.packageName || "充值套餐"}`,
    `金额：${amount}`,
    `积分：${request.credits ?? request.amount}`,
    `付款方式：${paymentMethod}`,
    `订单号：${request.paymentOutTradeNo || request.paymentOrderId || request.id}`,
    `提交时间：${new Date(request.createdAt).toLocaleString("zh-CN", { hour12: false })}`,
    `立即审核：${reviewUrl}`,
  ].join("\n")
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function renderRechargeEmail(input: {
  request: RechargeRequest
  amount: string
  paymentMethod: string
  reviewUrl: string
}): string {
  const request = input.request
  const rows = [
    ["用户", `${request.username || "未填写昵称"} · ${request.email || "未填写邮箱"}`],
    ["套餐", request.packageName || "充值套餐"],
    ["金额 / 积分", `${input.amount} · ${request.credits ?? request.amount} 积分`],
    ["付款方式", input.paymentMethod],
    ["订单号", request.paymentOutTradeNo || request.paymentOrderId || request.id],
    ["提交时间", new Date(request.createdAt).toLocaleString("zh-CN", { hour12: false })],
  ]
  const rowHtml = rows.map(([label, value]) => `
    <tr>
      <td style="width:92px;border-top:1px solid #edf2f8;padding:11px 8px 11px 0;color:#8290a5;">
        ${escapeHtml(label)}
      </td>
      <td style="border-top:1px solid #edf2f8;padding:11px 0;color:#233852;font-weight:600;">
        ${escapeHtml(value)}
      </td>
    </tr>`).join("")

  return `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;background:#f3f7fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#12233f;">
    <div style="max-width:620px;margin:0 auto;padding:32px 16px;">
      <div style="overflow:hidden;border:1px solid #d8e7f8;border-radius:12px;background:#fff;box-shadow:0 18px 50px rgba(22,119,255,.1);">
        <div style="height:6px;background:linear-gradient(90deg,#1677ff,#00c8ff,#315efb);"></div>
        <div style="padding:28px 30px 32px;">
          <div style="font-size:13px;font-weight:700;color:#1677ff;">势途 GEO 管理通知</div>
          <h1 style="margin:10px 0 8px;font-size:23px;color:#071a38;">新的积分充值申请</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.8;color:#66768d;">申请已经安全保存，请进入管理后台核对付款信息并完成审批。</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">${rowHtml}</table>
          <a href="${escapeHtml(input.reviewUrl)}" style="display:inline-block;margin-top:22px;border-radius:8px;background:#1677ff;padding:11px 20px;color:#fff;text-decoration:none;font-size:13px;font-weight:700;">立即进入后台审核</a>
        </div>
      </div>
      <p style="margin:14px 0 0;text-align:center;font-size:11px;color:#9aa5b5;">势途 GEO 全链路操作工具 · shitugeo.top</p>
    </div>
  </body>
</html>`
}
