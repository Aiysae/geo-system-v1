import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIGC 内容检测与优化",
  description: "检测文章 AI 生成率、营销性质，评估平台审核通过率，一键优化去痕迹",
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
