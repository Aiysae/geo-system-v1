import "server-only"

import { sendSystemEmail } from "@/lib/auth-email"
import type {
  ClientFeedbackAutomationReportResult,
  ClientFeedbackAutomationSchedule,
} from "@/types/client-feedback"

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

function reportName(report: ClientFeedbackAutomationReportResult): string {
  return `${report.label} GEO 执行反馈`
}

export function buildClientFeedbackAutomationEmail(input: {
  schedule: ClientFeedbackAutomationSchedule
  reports: ClientFeedbackAutomationReportResult[]
  test?: boolean
}): { subject: string; text: string; html: string } {
  const prefix = input.test ? "[测试] " : ""
  const subject = `${prefix}${input.schedule.clientName} · GEO 执行反馈已更新`
  const rows = input.reports.map(report => {
    const href = report.sharePath ? `${appBaseUrl()}${report.sharePath}` : `${appBaseUrl()}/workspace`
    return {
      title: reportName(report),
      period: `${report.periodStart} 至 ${report.periodEnd}`,
      href,
    }
  })
  const text = [
    `${input.schedule.clientName}的 GEO 执行反馈已生成。`,
    ...rows.map(row => `${row.title}（${row.period}）：${row.href}`),
    "链接为客户私密报告地址，请勿转发给无关人员。",
  ].join("\n\n")
  const reportCards = rows.map(row => `
    <div style="margin-top:14px;padding:18px;border:1px solid #d7e7f8;border-radius:10px;background:#f8fbff;">
      <div style="font-size:16px;font-weight:800;color:#092a55;">${escapeHtml(row.title)}</div>
      <div style="margin-top:6px;font-size:13px;color:#6b7f97;">${escapeHtml(row.period)}</div>
      <a href="${escapeHtml(row.href)}" style="display:inline-block;margin-top:14px;padding:10px 18px;border-radius:7px;background:#1677ff;color:#fff;text-decoration:none;font-size:13px;font-weight:800;">查看完整报告</a>
    </div>`).join("")
  const html = `<!doctype html>
<html lang="zh-CN"><body style="margin:0;background:#f1f7fd;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#12233f;">
  <div style="max-width:640px;margin:0 auto;padding:32px 16px;">
    <div style="overflow:hidden;border:1px solid #d7e7f8;border-radius:12px;background:#fff;box-shadow:0 20px 54px rgba(22,119,255,.12);">
      <div style="height:6px;background:linear-gradient(90deg,#1677ff,#00aeef,#13c2c2);"></div>
      <div style="padding:30px 32px 34px;">
        <div style="font-size:14px;font-weight:800;color:#1677ff;">势途 GEO 全链路操作工具</div>
        <h1 style="margin:12px 0 8px;font-size:24px;line-height:1.45;color:#071a38;">${escapeHtml(input.schedule.clientName)}执行反馈已更新</h1>
        <p style="margin:0;font-size:14px;line-height:1.8;color:#60708a;">本次生成 ${rows.length} 份客户反馈报告，可通过下方私密链接查看完整动作、效果对比和当前进度。</p>
        ${reportCards}
        <p style="margin:22px 0 0;font-size:12px;line-height:1.8;color:#8a96a8;">链接包含客户项目数据，请勿转发给无关人员。报告为生成时的数据快照，后续补录不会修改已发送版本。</p>
      </div>
    </div>
    <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#9aa5b5;">杭州势途数字科技有限公司 · shitugeo.top</p>
  </div>
</body></html>`
  return { subject, text, html }
}

export async function sendClientFeedbackAutomationEmail(input: {
  to: string
  schedule: ClientFeedbackAutomationSchedule
  reports: ClientFeedbackAutomationReportResult[]
  test?: boolean
  messageId?: string
}): Promise<void> {
  const message = buildClientFeedbackAutomationEmail(input)
  await sendSystemEmail({ to: input.to, messageId: input.messageId, ...message })
}
