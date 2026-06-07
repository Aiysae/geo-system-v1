import { NextResponse, type NextRequest } from "next/server"
import { AUTH_COOKIE_NAME, verifySessionCookieValue } from "@/lib/session-cookie"

const PUBLIC_PATHS = ["/sign-in", "/sign-up"]

export default function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const isPublicPath = PUBLIC_PATHS.some(path => pathname.startsWith(path))
  const sessionId = verifySessionCookieValue(req.cookies.get(AUTH_COOKIE_NAME)?.value)

  if (isPublicPath && sessionId) {
    return NextResponse.redirect(new URL("/", req.url))
  }

  if (!isPublicPath && !pathname.startsWith("/api") && !sessionId) {
    const signInUrl = new URL("/sign-in", req.url)
    signInUrl.searchParams.set("redirect_url", pathname + search)
    return NextResponse.redirect(signInUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
