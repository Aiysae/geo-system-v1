import "server-only"

import { sendSystemEmail } from "@/lib/auth-email"

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

export async function sendPenetrationAutomationAlertEmail(input: {
  to: string
  accountName: string
  clientName: string
  historyRecordId: string
  baselineRate: number
  currentRate: number
  relativeDropPct: number
  absoluteDropPoints: number
}): Promise<void> {
  const reportUrl = `${appBaseUrl()}/workspace/results/penetration/${encodeURIComponent(input.historyRecordId)}`
  const subject = `${input.clientName}渗透率下降 ${input.relativeDropPct.toFixed(1)}%`
  const text = [
    `${input.accountName}，您好：`,
    `${input.clientName}本次自动检测的渗透率由 ${(input.baselineRate * 100).toFixed(1)}% 降至 ${(input.currentRate * 100).toFixed(1)}%。`,
    `相对下降 ${input.relativeDropPct.toFixed(1)}%，下降 ${input.absoluteDropPoints.toFixed(1)} 个百分点。`,
    `查看完整报告：${reportUrl}`,
  ].join("\n\n")
  const html = `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#f2f7fd;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#12233f;"><div style="max-width:620px;margin:0 auto;padding:32px 16px;"><div style="overflow:hidden;border:1px solid #d8e7f7;border-radius:12px;background:#fff;box-shadow:0 20px 54px rgba(22,119,255,.12);"><div style="height:6px;background:linear-gradient(90deg,#1677ff,#00aeef,#13c2c2);"></div><div style="padding:30px 32px 34px;"><div style="font-size:14px;font-weight:800;color:#1677ff;">势途 GEO</div><h1 style="margin:12px 0 10px;font-size:23px;line-height:1.45;color:#071a38;">渗透率下降提醒</h1><p style="margin:0;font-size:14px;line-height:1.9;color:#60708a;">${escapeHtml(input.accountName)}，${escapeHtml(input.clientName)}本次自动检测的渗透率由 <strong>${(input.baselineRate * 100).toFixed(1)}%</strong> 降至 <strong style="color:#e11d48;">${(input.currentRate * 100).toFixed(1)}%</strong>，相对下降 ${input.relativeDropPct.toFixed(1)}%。</p><a href="${escapeHtml(reportUrl)}" style="display:inline-block;margin:24px 0 8px;padding:12px 22px;border-radius:8px;background:linear-gradient(90deg,#1677ff,#00aeea);color:#fff;text-decoration:none;font-size:14px;font-weight:800;">查看完整检测报告</a></div></div><p style="margin:16px 0 0;text-align:center;font-size:11px;color:#9aa5b5;">势途 GEO 全链路操作工具 · shitugeo.top</p></div></body></html>`
  await sendSystemEmail({ to: input.to, subject, text, html })
}
