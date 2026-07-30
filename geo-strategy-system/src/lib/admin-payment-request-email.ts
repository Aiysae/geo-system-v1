import "server-only"

import { sendSystemEmail } from "@/lib/auth-email"
import {
  getAdminPaymentRequestRecord,
  mutateAdminPaymentRequestRecord,
} from "@/lib/admin-payment-request-store"
import { kv } from "@/lib/kv"

const KEY_LOCK = (id: string) => `admin_payment_requests:email-lock:${id}`

function appUrl(): string {
  return String(
    process.env.APP_BASE_URL
      || process.env.PUBLIC_APP_URL
      || process.env.NEXT_PUBLIC_APP_URL
      || "https://shitugeo.top",
  ).trim().replace(/\/+$/, "")
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  })
}

export async function deliverAdminPaymentRequestEmail(
  requestId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const record = await getAdminPaymentRequestRecord(requestId)
  if (!record) throw new Error("付款请求不存在")
  if (record.status === "canceled") throw new Error("付款请求已取消")
  if (!options.force && record.emailStatus === "sent") return
  if (!options.force && record.emailAttempts >= 6) return

  const locked = await kv.set(KEY_LOCK(record.id), "locked", { nx: true, ex: 120 })
  if (!locked) return
  const attempts = record.emailAttempts + 1
  try {
    const paymentUrl = `${appUrl()}/account/payment-requests/${encodeURIComponent(record.id)}`
    const amount = `¥${(record.priceCents / 100).toFixed(2)}`
    const text = [
      `${record.username}，您好：`,
      `您有一笔新的付款订单：${record.title}`,
      `订单金额：${amount}`,
      `到账积分：${record.credits} 积分`,
      `有效期至：${formatTime(record.expiresAt)}`,
      record.note ? `订单说明：${record.note}` : "",
      `查看并付款：${paymentUrl}`,
      "如对订单内容有疑问，请先联系势途 GEO 客服确认。",
    ].filter(Boolean).join("\n\n")
    await sendSystemEmail({
      to: record.email,
      subject: `【势途 GEO】待付款订单 ${amount} · ${record.title}`,
      text,
      html: `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;background:#f2f7fd;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#12233f;">
    <div style="max-width:620px;margin:0 auto;padding:34px 16px;">
      <div style="overflow:hidden;border:1px solid #d8e7f7;border-radius:12px;background:#fff;box-shadow:0 20px 54px rgba(22,119,255,.12);">
        <div style="height:6px;background:linear-gradient(90deg,#1677ff,#00c8ff,#13c2c2);"></div>
        <div style="padding:30px 32px 34px;">
          <div style="font-size:14px;font-weight:800;color:#1677ff;">势途 GEO 付款通知</div>
          <h1 style="margin:12px 0 8px;font-size:24px;line-height:1.45;color:#071a38;">${escapeHtml(record.title)}</h1>
          <p style="margin:0;font-size:14px;line-height:1.9;color:#60708a;">${escapeHtml(record.username)}，您有一笔待付款订单。</p>
          <div style="margin:22px 0;display:grid;grid-template-columns:1fr 1fr;border:1px solid #d8e7f7;border-radius:10px;overflow:hidden;">
            <div style="padding:16px;background:#f6faff;border-right:1px solid #d8e7f7;"><div style="font-size:12px;color:#7c8ba1;">订单金额</div><div style="margin-top:5px;font-size:25px;font-weight:800;color:#0958d9;">${escapeHtml(amount)}</div></div>
            <div style="padding:16px;background:#f6faff;"><div style="font-size:12px;color:#7c8ba1;">到账积分</div><div style="margin-top:5px;font-size:25px;font-weight:800;color:#0b8f8a;">${record.credits}</div></div>
          </div>
          ${record.note ? `<p style="margin:0 0 16px;padding:12px 14px;border-radius:8px;background:#f8fafc;font-size:13px;line-height:1.8;color:#66768d;">${escapeHtml(record.note).replaceAll("\n", "<br>")}</p>` : ""}
          <p style="margin:0;font-size:12px;color:#8a96a8;">请在 ${escapeHtml(formatTime(record.expiresAt))} 前完成付款。</p>
          <a href="${escapeHtml(paymentUrl)}" style="display:inline-block;margin-top:22px;padding:12px 22px;border-radius:8px;background:linear-gradient(90deg,#1677ff,#00aeea);color:#fff;text-decoration:none;font-size:14px;font-weight:800;">查看订单并付款</a>
        </div>
      </div>
      <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#9aa5b5;">势途 GEO 全链路操作工具 · shitugeo.top</p>
    </div>
  </body>
</html>`,
    })
    await mutateAdminPaymentRequestRecord(record.id, current => ({
      ...current,
      emailStatus: "sent",
      emailAttempts: attempts,
      emailUpdatedAt: Date.now(),
      emailSentAt: Date.now(),
      emailError: undefined,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : "邮件发送失败"
    await mutateAdminPaymentRequestRecord(record.id, current => ({
      ...current,
      emailStatus: "failed",
      emailAttempts: attempts,
      emailUpdatedAt: Date.now(),
      emailError: message.slice(0, 300),
    }))
    throw error
  } finally {
    await kv.del(KEY_LOCK(record.id))
  }
}
