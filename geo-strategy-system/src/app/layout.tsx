import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { CreditsProvider } from "@/components/credits/credits-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "势途 GEO — 生成式引擎优化提效终端",
  description: "势途 GEO — 面向国内大模型的生成式引擎优化策略工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/sign-in"
    >
      <html
        lang="zh-CN"
        className="h-full antialiased"
      >
        <body className="min-h-full bg-slate-50">
          <CreditsProvider>{children}</CreditsProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
