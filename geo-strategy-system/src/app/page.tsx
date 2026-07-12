import type { Metadata } from "next"
import BrandHome from "@/components/brand/brand-home"
import { getCurrentUser } from "@/lib/auth"

const SITE_URL = "https://shitugeo.top"

export const metadata: Metadata = {
  title: "势途 GEO | GEO 全链路操作工具",
  description: "势途 GEO 是面向主流大模型的 GEO 全链路操作工具，提供品牌可见度检测、联网盲测、竞品情报、难度测评、关键词策略与文章生成。",
  alternates: {
    canonical: `${SITE_URL}/`,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
}

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "杭州势途数字科技有限公司",
      alternateName: ["势途", "势途 GEO", "SHITU"],
      url: `${SITE_URL}/`,
      logo: {
        "@type": "ImageObject",
        "@id": `${SITE_URL}/#logo`,
        url: `${SITE_URL}/brand/shitu-lockup.jpg`,
        contentUrl: `${SITE_URL}/brand/shitu-lockup.jpg`,
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: "势途 GEO",
      description: "面向主流大模型的 GEO 全链路操作工具。",
      inLanguage: "zh-CN",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#webapplication`,
      name: "势途 GEO",
      alternateName: "GEO 全链路操作工具",
      url: `${SITE_URL}/`,
      description: "面向品牌、企业与 GEO 服务团队的品牌可见度检测、竞品情报、难度测评、关键词策略与文章生成工具。",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Generative Engine Optimization (GEO)",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript and a modern web browser.",
      inLanguage: "zh-CN",
      provider: { "@id": `${SITE_URL}/#organization` },
      featureList: [
        "渗透率情报与品牌可见度检测",
        "行业与竞品独立调研",
        "品牌与内容 AI 诊断",
        "GEO 竞争难度测评",
        "关键词、疑问句与优势匹配策略",
        "Markdown 文章生成与改写",
      ],
    },
    {
      "@type": "WebPage",
      "@id": `${SITE_URL}/#webpage`,
      url: `${SITE_URL}/`,
      name: "势途 GEO | GEO 全链路操作工具",
      description: "势途 GEO 官网与平台入口，展示六大 GEO 核心能力。",
      inLanguage: "zh-CN",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      about: [
        { "@id": `${SITE_URL}/#organization` },
        { "@id": `${SITE_URL}/#webapplication` },
      ],
      mainEntity: { "@id": `${SITE_URL}/#webapplication` },
    },
  ],
}

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function HomePage() {
  const user = await getCurrentUser()

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <BrandHome
        user={user ? { name: user.name, role: user.role } : null}
      />
    </>
  )
}
