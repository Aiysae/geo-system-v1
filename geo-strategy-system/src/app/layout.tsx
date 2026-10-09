import type { Metadata, Viewport } from "next";
import { CreditsProvider } from "@/components/credits/credits-provider";
import { DesktopRuntimeBridge } from "@/components/desktop/desktop-runtime-bridge";
import { PwaRuntime } from "@/components/pwa/pwa-runtime";
import "./globals.css";

const SITE_URL = "https://shitugeo.top";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "势途 GEO | AI 可见度与生成式搜索增长平台",
  description: "势途 GEO 面向主流大模型，提供品牌可见度检测、竞品情报、GEO 策略与内容生成。",
  applicationName: "势途 GEO",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "势途 GEO",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/pwa/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0637A6",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      <body className="geo-app-surface min-h-full bg-slate-50">
        <CreditsProvider>
          <PwaRuntime />
          <DesktopRuntimeBridge />
          {children}
        </CreditsProvider>
      </body>
    </html>
  );
}
