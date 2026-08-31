import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "势途 GEO · GEO 全链路操作工具",
    short_name: "势途 GEO",
    description: "品牌与个人 IP 的 AI 可见度检测、竞品情报、关键词策略、内容生产与执行反馈工作台。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#020B2D",
    theme_color: "#0637A6",
    lang: "zh-CN",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/pwa/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "进入 GEO 工作台",
        short_name: "工作台",
        description: "继续客户检测、策略与内容任务",
        url: "/workspace",
        icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "我的主页",
        short_name: "我的主页",
        description: "查看客户、历史报告、积分和账号信息",
        url: "/account",
        icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }],
      },
    ],
  }
}
