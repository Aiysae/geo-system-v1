import { NextResponse, type NextRequest } from "next/server"
import { AUTH_COOKIE_NAME, verifySessionCookieValue } from "@/lib/session-cookie"

const PUBLIC_PATHS = ["/sign-in", "/sign-up"]

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  response.headers.set("Pragma", "no-cache")
  return response
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const isPublicPath = PUBLIC_PATHS.some(path => pathname.startsWith(path))
  const sessionId = verifySessionCookieValue(req.cookies.get(AUTH_COOKIE_NAME)?.value)

  if (isPublicPath && sessionId) {
    const homeUrl = req.nextUrl.clone()
    homeUrl.pathname = "/"
    homeUrl.search = ""
    return noStore(NextResponse.redirect(homeUrl))
  }

  if (!isPublicPath && !pathname.startsWith("/api") && !sessionId) {
    const signInUrl = req.nextUrl.clone()
    signInUrl.pathname = "/sign-in"
    signInUrl.search = ""
    signInUrl.searchParams.set("redirect_url", pathname + search)
    return noStore(NextResponse.redirect(signInUrl))
  }

  const response = NextResponse.next()
  if (!pathname.startsWith("/api")) {
    return noStore(response)
  }
  return response
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
