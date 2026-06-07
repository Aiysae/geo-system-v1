import { NextResponse } from "next/server"
import { destroySession } from "@/lib/auth"
import { AUTH_COOKIE_NAME } from "@/lib/session-cookie"
import { isSecureRequest } from "@/lib/request-security"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map(item => item.trim())
    .find(item => item.startsWith(`${AUTH_COOKIE_NAME}=`))
    ?.slice(AUTH_COOKIE_NAME.length + 1)

  await destroySession(cookie ? decodeURIComponent(cookie) : undefined)

  const response = NextResponse.json({ ok: true })
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })

  return response
}
