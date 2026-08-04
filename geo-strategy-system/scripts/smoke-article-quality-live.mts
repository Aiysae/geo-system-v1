import { NextRequest } from "next/server"

const email = String(process.env.ARTICLE_SMOKE_USER_EMAIL || "3058767864@qq.com").trim()
const { getUserByEmail } = await import("../src/lib/auth")
const { createInternalApiHeaders, INTERNAL_API_USER_HEADER } = await import("../src/lib/internal-api")
const { POST } = await import("../src/app/api/article-generation/route")
const { closeKvConnection } = await import("../src/lib/kv")

const user = await getUserByEmail(email)
if (!user) throw new Error(`未找到冒烟测试账号：${email}`)

const request = new NextRequest("http://localhost/api/article-generation", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...createInternalApiHeaders("background-job"),
    [INTERNAL_API_USER_HEADER]: user.id,
  },
  body: JSON.stringify({
    promptKey: "selectionPitfallGuide",
    modelProvider: "doubao",
    clientName: "势途 GEO",
    brandName: "势途 GEO",
    subjectType: "brand",
    industry: "企业 GEO 与 AI 搜索优化",
    website: "https://shitugeo.top/",
    coreQuestion: "企业选择 GEO 服务商时，应该重点核验哪些真实能力？",
    keywords: "GEO 服务商\nAI 搜索优化\nGEO 效果验收",
    region: "中国大陆",
    business: "多模型疑问句检测、关键词策略、内容生产与执行反馈",
    advantages: "系统可保留模型原始回答、联网信源和历史报告，便于客户核验执行过程。",
    audience: "正在评估 GEO 服务的企业品牌负责人",
    extraRequirements: "结论克制，不得声称市场第一，硬事实必须有资料或联网来源。",
    comparisonBrands: [],
    methodology: {
      mode: "auto",
      articleFormat: "auto",
      targetPlatform: "universal",
      brandLayout: "auto",
      titleStrategy: "auto",
    },
  }),
})

try {
  const startedAt = Date.now()
  const response = await POST(request)
  const data = await response.json() as Record<string, unknown>
  const article = String(data.article || "")
  const quality = data.qualityAudit && typeof data.qualityAudit === "object"
    ? data.qualityAudit as Record<string, unknown>
    : {}
  const connectivity = data.connectivity && typeof data.connectivity === "object"
    ? data.connectivity as Record<string, unknown>
    : {}
  const summary = {
    ok: response.ok,
    status: response.status,
    elapsedMs: Date.now() - startedAt,
    title: article.match(/^#\s+(.+)$/m)?.[1]?.slice(0, 120) || "",
    articleLength: article.length,
    modelProvider: data.modelProvider,
    model: data.model,
    connectivityMode: connectivity.mode,
    sourceCount: connectivity.sourceCount,
    pipelineVersion: quality.pipelineVersion,
    planUsedFallback: quality.planUsedFallback,
    deterministicScore: quality.deterministicScore,
    semanticScore: quality.semanticScore,
    repaired: quality.repaired,
    finalPassed: quality.finalPassed,
    error: data.error,
  }
  console.log(JSON.stringify(summary, null, 2))
  if (!response.ok || !article || quality.finalPassed !== true) process.exitCode = 1
} finally {
  await closeKvConnection()
}
