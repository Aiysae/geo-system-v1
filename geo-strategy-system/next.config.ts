import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "192.168.43.92"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
