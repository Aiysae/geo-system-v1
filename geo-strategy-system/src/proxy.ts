import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
])

export default clerkMiddleware(
  async (auth, req) => {
    if (!isPublicRoute(req)) {
      if (!req.nextUrl.pathname.startsWith("/api")) {
        const signInUrl = new URL("/sign-in", req.url)
        signInUrl.searchParams.set("redirect_url", req.nextUrl.pathname + req.nextUrl.search)
        await auth.protect({ unauthenticatedUrl: signInUrl.toString() })
        return
      }

      await auth.protect()
    }
  },
  { frontendApiProxy: { enabled: true } }
)

export const config = {
  matcher: [
    "/__clerk(.*)",
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
