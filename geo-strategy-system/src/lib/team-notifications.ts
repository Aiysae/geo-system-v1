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

export function teamInviteUrl(token: string): string {
  return `${appBaseUrl()}/team-invite/${encodeURIComponent(token)}`
}

export async function sendTeamInviteEmail(input: {
  to: string
  teamName: string
  inviterName: string
  token: string
  expiresAt: string
}): Promise<void> {
  const inviteUrl = teamInviteUrl(input.token)
  const teamName = escapeHtml(input.teamName)
  const inviterName = escapeHtml(input.inviterName)
  const expiresAt = new Date(input.expiresAt).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  })
  await sendSystemEmail({
    to: input.to,
    subject: `${input.inviterName} 邀请您加入 ${input.teamName}`,
    text: [
      `${input.inviterName} 邀请您加入势途 GEO 团队“${input.teamName}”。`,
      `接受邀请：${inviteUrl}`,
      `邀请有效期至：${expiresAt}`,
      "请使用收到邀请的邮箱注册或登录。",
    ].join("\n\n"),
    html: `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;background:#f2f7fd;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#12233f;">
    <div style="max-width:600px;margin:0 auto;padding:34px 16px;">
      <div style="overflow:hidden;border:1px solid #d8e7f7;border-radius:12px;background:#fff;box-shadow:0 20px 54px rgba(22,119,255,.12);">
        <div style="height:6px;background:linear-gradient(90deg,#1677ff,#00aeef,#13c2c2);"></div>
        <div style="padding:30px 32px 34px;">
          <div style="font-size:14px;font-weight:800;color:#1677ff;">势途 GEO</div>
          <h1 style="margin:12px 0 10px;font-size:24px;line-height:1.45;color:#071a38;">加入 ${teamName}</h1>
          <p style="margin:0;font-size:14px;line-height:1.9;color:#60708a;"><strong style="color:#253858;">${inviterName}</strong> 邀请您加入团队。接受后，您将按被授予的模块权限查看或操作共享客户档案。</p>
          <a href="${inviteUrl}" style="display:inline-block;margin:24px 0 18px;padding:12px 22px;border-radius:8px;background:linear-gradient(90deg,#1677ff,#00aeea);color:#fff;text-decoration:none;font-size:14px;font-weight:800;">接受团队邀请</a>
          <p style="margin:0;font-size:12px;line-height:1.8;color:#8a96a8;">请使用收到邀请的邮箱注册或登录。邀请有效期至 ${escapeHtml(expiresAt)}。</p>
        </div>
      </div>
      <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#9aa5b5;">势途 GEO 全链路操作工具 · shitugeo.top</p>
    </div>
  </body>
</html>`,
  })
}
