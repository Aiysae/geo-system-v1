import "server-only"

import nodemailer, { type Transporter } from "nodemailer"

export type AuthEmailPurpose = "sign-up" | "sign-in" | "password-reset"

type AuthEmailConfig = {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  fromAddress: string
  fromName: string
  replyTo?: string
}

const mailGlobal = globalThis as typeof globalThis & {
  __geoAuthEmailTransporter?: Transporter
}

const PURPOSE_COPY: Record<AuthEmailPurpose, { subject: string; action: string }> = {
  "sign-up": {
    subject: "势途 GEO 注册验证码",
    action: "完成账号注册",
  },
  "sign-in": {
    subject: "势途 GEO 登录验证码",
    action: "登录势途 GEO",
  },
  "password-reset": {
    subject: "势途 GEO 密码重置验证码",
    action: "重置账号密码",
  },
}

export class AuthEmailConfigurationError extends Error {
  constructor() {
    super("验证码邮件服务暂未配置，请联系管理员")
    this.name = "AuthEmailConfigurationError"
  }
}

export class AuthEmailDeliveryError extends Error {
  constructor() {
    super("验证码邮件发送失败，请稍后重试")
    this.name = "AuthEmailDeliveryError"
  }
}

function readConfig(): AuthEmailConfig | null {
  const user = String(process.env.AUTH_EMAIL_SMTP_USER || "").trim()
  const password = String(process.env.AUTH_EMAIL_SMTP_PASSWORD || "").trim()
  const fromAddress = String(process.env.AUTH_EMAIL_FROM_ADDRESS || user).trim()
  if (!user || !password || !fromAddress) return null

  const configuredPort = Number(process.env.AUTH_EMAIL_SMTP_PORT || 465)
  const port = Number.isFinite(configuredPort) && configuredPort > 0
    ? Math.floor(configuredPort)
    : 465
  const secureSetting = String(process.env.AUTH_EMAIL_SMTP_SECURE || "").trim().toLowerCase()

  return {
    host: String(process.env.AUTH_EMAIL_SMTP_HOST || "smtpdm.aliyun.com").trim(),
    port,
    secure: secureSetting ? secureSetting === "true" : port === 465,
    user,
    password,
    fromAddress,
    fromName: String(process.env.AUTH_EMAIL_FROM_NAME || "势途 GEO").trim(),
    replyTo: String(process.env.AUTH_EMAIL_REPLY_TO || "").trim() || undefined,
  }
}

export function isAuthEmailConfigured(): boolean {
  return Boolean(readConfig())
}

export function assertAuthEmailConfigured(): void {
  if (!readConfig()) throw new AuthEmailConfigurationError()
}

function getTransporter(config: AuthEmailConfig): Transporter {
  if (mailGlobal.__geoAuthEmailTransporter) return mailGlobal.__geoAuthEmailTransporter

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
    pool: true,
    maxConnections: 2,
    maxMessages: 100,
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000,
  })
  mailGlobal.__geoAuthEmailTransporter = transporter
  return transporter
}

export async function sendAuthVerificationEmail(input: {
  email: string
  code: string
  purpose: AuthEmailPurpose
  expiresInMinutes: number
}): Promise<void> {
  const config = readConfig()
  if (!config) throw new AuthEmailConfigurationError()

  const copy = PURPOSE_COPY[input.purpose]
  const safeCode = input.code.replace(/\D/g, "").slice(0, 6)
  const text = [
    `您正在${copy.action}。`,
    `验证码：${safeCode}`,
    `验证码 ${input.expiresInMinutes} 分钟内有效，请勿转发给他人。`,
    "如非本人操作，请忽略本邮件。",
  ].join("\n\n")

  try {
    await getTransporter(config).sendMail({
      from: {
        name: config.fromName,
        address: config.fromAddress,
      },
      to: input.email,
      replyTo: config.replyTo,
      subject: copy.subject,
      text,
      html: renderVerificationEmail({
        code: safeCode,
        action: copy.action,
        expiresInMinutes: input.expiresInMinutes,
      }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error"
    console.error(`[auth-email] Delivery failed: ${message}`)
    throw new AuthEmailDeliveryError()
  }
}

function renderVerificationEmail(input: {
  code: string
  action: string
  expiresInMinutes: number
}): string {
  return `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;background:#f4f8ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#12233f;">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="overflow:hidden;border:1px solid #dce8f8;border-radius:12px;background:#ffffff;box-shadow:0 18px 50px rgba(22,119,255,.10);">
        <div style="height:6px;background:linear-gradient(90deg,#1677ff,#00c8ff,#315efb);"></div>
        <div style="padding:30px 32px 34px;">
          <div style="font-size:14px;font-weight:700;color:#1677ff;letter-spacing:0;">势途 GEO</div>
          <h1 style="margin:12px 0 8px;font-size:24px;line-height:1.4;color:#071a38;">邮箱验证码</h1>
          <p style="margin:0;font-size:14px;line-height:1.8;color:#60708a;">您正在${input.action}，请输入下方验证码：</p>
          <div style="margin:24px 0;padding:19px 16px;border-radius:10px;background:#edf6ff;text-align:center;font-size:34px;font-weight:800;line-height:1;letter-spacing:8px;color:#0958d9;">${input.code}</div>
          <p style="margin:0;font-size:13px;line-height:1.8;color:#7a879b;">验证码 ${input.expiresInMinutes} 分钟内有效，且只能使用一次。请勿将验证码转发给他人。</p>
          <p style="margin:18px 0 0;font-size:12px;line-height:1.8;color:#9aa5b5;">如非本人操作，请忽略本邮件。</p>
        </div>
      </div>
      <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#9aa5b5;">势途 GEO 全链路操作工具 · shitugeo.top</p>
    </div>
  </body>
</html>`
}
