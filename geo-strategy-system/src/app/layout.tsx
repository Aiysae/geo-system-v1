import type { Metadata } from "next";
import { CreditsProvider } from "@/components/credits/credits-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "势途 GEO | AI 可见度与生成式搜索增长平台",
  description: "势途 GEO 面向主流大模型，提供品牌可见度检测、竞品情报、GEO 策略与内容生成。",
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
        <CreditsProvider>{children}</CreditsProvider>
      </body>
    </html>
  );
}
