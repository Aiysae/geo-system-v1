import type { NextConfig } from "next";

const lowMemoryBuild = process.env.GEO_LOW_MEMORY_BUILD === "1";
const skipBuildTypecheck = process.env.GEO_SKIP_BUILD_TYPECHECK === "1";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "192.168.43.92"],
  typescript: {
    // ECS deployments run `tsc --noEmit` on the runner before this build.
    ignoreBuildErrors: skipBuildTypecheck,
  },
  experimental: lowMemoryBuild ? { cpus: 1 } : {},
  turbopack: {
    root: process.cwd(),
  },
  poweredByHeader: false,
  headers() {
    return [
      {
        // Account, billing and admin pages perform sensitive actions, so they
        // must not be framed by other sites. Same-origin report previews
        // (report-history-dialog) still embed /api/reports/.../view.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
