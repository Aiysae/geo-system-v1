import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "关键词策略 — GEO 策略生成工具",
  description: "生成式引擎优化（GEO）策略方案生成工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full bg-slate-50">{children}</body>
    </html>
  );
}
