import type { MetadataRoute } from "next"

const SITE_URL = "https://shitugeo.top"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/workspace",
        "/api",
        "/sign-in",
        "/sign-up",
        "/forgot-password",
        "/reset-password",
        "/billing",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
