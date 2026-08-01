import "server-only"

export function agentPublicOrigin(request: Request): string {
  const configured = String(
    process.env.PUBLIC_APP_URL
      || process.env.NEXT_PUBLIC_APP_URL
      || "",
  ).trim()
  if (configured) {
    const url = new URL(configured)
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
      throw new Error("PUBLIC_APP_URL 必须是不含账号信息的 HTTP(S) 地址")
    }
    return url.origin
  }
  return process.env.NODE_ENV === "production"
    ? "https://shitugeo.top"
    : new URL(request.url).origin
}
