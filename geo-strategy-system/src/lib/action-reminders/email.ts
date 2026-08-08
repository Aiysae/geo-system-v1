import "server-only"

import { sendSystemEmail } from "@/lib/auth-email"

export type ActionReminderEmailClient = {
  clientId: string
  clientName: string
}

function appBaseUrl(): string {
  return String(
    process.env.APP_BASE_URL
      || process.env.PUBLIC_APP_URL
      || process.env.NEXT_PUBLIC_APP_URL
      || "https://shitugeo.top",
  ).trim().replace(/\/+$/, "")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function feedbackUrl(clientId: string): string {
  const params = new URLSearchParams({ module: "feedback" })
  if (clientId) params.set("clientId", clientId)
  return `${appBaseUrl()}/workspace?${params.toString()}`
}

export function buildActionReminderEmail(input: {
  accountName: string
  date: string
  clients: ActionReminderEmailClient[]
}): { subject: string; text: string; html: string } {
  const firstClientId = input.clients[0]?.clientId || ""
  const actionUrl = feedbackUrl(firstClientId)
  const visibleClients = input.clients.slice(0, 12)
  const hiddenCount = Math.max(0, input.clients.length - visibleClients.length)
  const subject = `执行反馈提醒：今天还有 ${input.clients.length} 个客户待录入`
  const clientLines = visibleClients.map(client => `- ${client.clientName}`)
  if (hiddenCount > 0) clientLines.push(`- 另有 ${hiddenCount} 个客户`)

  const text = [
    `${input.accountName}，您好：`,
    `今天（${input.date}）还有 ${input.clients.length} 个客户尚未录入执行动作。`,
    clientLines.join("\n"),
    `去录入：${actionUrl}`,
    "及时记录执行动作，可以让客户看到更完整的周报、月报和效果进度。",
  ].join("\n\n")

  const clientItems = visibleClients
    .map(client => `<li style="padding:7px 0;border-bottom:1px solid #e7f0fb;">${escapeHtml(client.clientName)}</li>`)
    .join("")
  const remainder = hiddenCount > 0
    ? `<li style="padding:7px 0;color:#64748b;">另有 ${hiddenCount} 个客户</li>`
    : ""

  const html = `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;background:#f2f7fd;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#12233f;">
    <div style="max-width:620px;margin:0 auto;padding:32px 16px;">
      <div style="overflow:hidden;border:1px solid #d8e7f7;border-radius:12px;background:#fff;box-shadow:0 20px 54px rgba(22,119,255,.12);">
        <div style="height:6px;background:linear-gradient(90deg,#1677ff,#00aeef,#13c2c2);"></div>
        <div style="padding:30px 32px 34px;">
          <div style="font-size:14px;font-weight:800;color:#1677ff;">势途 GEO</div>
          <h1 style="margin:12px 0 10px;font-size:23px;line-height:1.45;color:#071a38;">今晚的执行动作还未录完</h1>
          <p style="margin:0;font-size:14px;line-height:1.9;color:#60708a;">${escapeHtml(input.accountName)}，今天（${escapeHtml(input.date)}）还有 <strong style="color:#0958d9;">${input.clients.length}</strong> 个客户尚未录入执行动作。</p>
          <ul style="margin:20px 0 0;padding:0;list-style:none;font-size:14px;line-height:1.7;color:#253858;">${clientItems}${remainder}</ul>
          <a href="${escapeHtml(actionUrl)}" style="display:inline-block;margin:24px 0 16px;padding:12px 22px;border-radius:8px;background:linear-gradient(90deg,#1677ff,#00aeea);color:#fff;text-decoration:none;font-size:14px;font-weight:800;">去录入执行动作</a>
          <p style="margin:0;font-size:12px;line-height:1.8;color:#8a96a8;">及时记录执行动作，可以让客户看到更完整的周报、月报和效果进度。</p>
        </div>
      </div>
      <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#9aa5b5;">势途 GEO 全链路操作工具 · shitugeo.top</p>
    </div>
  </body>
</html>`

  return { subject, text, html }
}

export async function sendActionReminderEmail(input: {
  to: string
  accountName: string
  date: string
  clients: ActionReminderEmailClient[]
}): Promise<void> {
  const message = buildActionReminderEmail(input)
  await sendSystemEmail({ to: input.to, ...message })
}
