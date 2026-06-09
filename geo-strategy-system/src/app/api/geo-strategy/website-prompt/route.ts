import { NextRequest, NextResponse } from "next/server"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { openaiCompatChat } from "@/lib/llm/openai-compat"
import type { GeoStrategyPlan } from "@/types/geo-strategy"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

const SYSTEM_PROMPT = `你是一位资深全栈工程师、产品设计师、Prompt 工程师和中国国内 GEO（生成式引擎优化）专家。

你的任务不是直接编写网站代码，而是生成一段用户可直接复制给编程 AI 使用的“完整官网建设 Prompt”。

硬性要求：
1. 只输出一段完整 Prompt 正文，不要解释、前言、总结或 Markdown 代码围栏。
2. 必须把全部官网建设建议合并为一个整站任务，不能按模块拆成多段独立 Prompt。
3. Prompt 要求编程 AI 交付完整、可运行、可部署的网站代码，而不是方案、线框图或伪代码。
4. Prompt 必须覆盖桌面端和手机端、页面结构、视觉与交互、技术实现、SEO/GEO、验收和交付文件。
5. GEO 要求必须包含但不限于：语义化 HTML、Schema.org JSON-LD、EEAT、倒金字塔内容结构、唯一且清晰的 H1/H2/H3、FAQ/Q&A、实体与事实一致性、内部链接、Canonical、Meta、Open Graph、站点地图和可抓取性。
6. 必须要求编程 AI 在交付前按中国国内 GEO 方法论自查并直接修正问题，再报告修改结果。
7. 必须要求输出可直接使用的 llms.txt 和 robots.txt 完整内容及放置路径。
8. 不得在 Prompt 中加入“资料包”章节，不得复述上传文件、OCR 原文或假装资料已经包含在 Prompt 中。只需说明：品牌和业务资料由用户在执行该 Prompt 时另行提供，收到后再据此填充真实内容。
9. 避免虚构品牌数字、资质、案例、排名、客户评价或竞争结论；缺失事实必须使用明确占位符并等待用户提供。
10. 如果内容较长，可以要求编程 AI 分阶段执行，但所有阶段必须属于同一个连续的整站任务。`

function buildGenerationContext(plan: GeoStrategyPlan): string {
  const profile = plan.profile
  const keywords = [
    ...(plan.keyword_strategy?.core_keywords || []),
    ...(plan.keyword_strategy?.pain_advantage_keywords || []),
    ...(plan.keyword_strategy?.weakness_conversion_keywords || []),
    ...(plan.keyword_strategy?.scenario_keywords || []),
  ]
    .map(item => item?.keyword?.trim())
    .filter(Boolean)
    .slice(0, 30)

  const officialStrategy = (plan.official_site_strategy || []).map((item, index) => ({
    order: index + 1,
    module: item.module,
    action: item.action,
    goal: item.goal,
  }))

  return [
    "请根据以下已确认的官网策略上下文，生成一段完整、可复制、可直接执行的整站建设 Prompt。",
    "",
    "【项目基本信息】",
    `项目名称：${plan.project_name || profile?.brand_or_product || "目标品牌官网"}`,
    `品牌/产品：${profile?.brand_or_product || "由用户另行提供"}`,
    `行业：${profile?.industry || "由用户另行提供"}`,
    `目标受众：${profile?.audience || "由用户另行提供"}`,
    `官网建设目标：${profile?.business_goals || plan.summary || "建设可信、可引用、利于生成式引擎理解和抓取的品牌官网"}`,
    "",
    "【需要合并进整站任务的官网策略】",
    JSON.stringify(officialStrategy, null, 2),
    "",
    "【建议覆盖的 GEO 关键词】",
    keywords.join("、") || "由用户另行提供",
    "",
    "生成时请特别注意：",
    "- 输出必须是一段整站 Prompt，不要给每个模块分别生成 Prompt。",
    "- 不要加入、构造或复述资料包。品牌资料由用户执行 Prompt 时另行提供。",
    "- Prompt 要明确页面清单、组件与功能、内容结构、技术交付顺序、移动端验收标准和 GEO 验收清单。",
    "- Prompt 要要求生成真实完整代码，并在最后输出 llms.txt、robots.txt、sitemap.xml 及关键 Schema JSON-LD。",
  ].join("\n")
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/^```(?:text|markdown|md)?\s*\n?([\s\S]*?)\n?```$/i)
  return (match?.[1] || trimmed).trim()
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { plan?: GeoStrategyPlan }
    const plan = body.plan

    if (!plan || !Array.isArray(plan.official_site_strategy) || plan.official_site_strategy.length === 0) {
      return NextResponse.json({ error: "缺少官网建设策略，请先生成完整 GEO 策略" }, { status: 400 })
    }

    const config = await getAiProviderRuntimeSetting("qwen")
    if (!config.apiKey) {
      return NextResponse.json(
        { error: "后台未配置通义千问 API Key，请在后台管理页的 AI 模型设置中完成配置" },
        { status: 400 }
      )
    }

    const prompt = await openaiCompatChat({
      url: buildAiChatUrl(config),
      apiKey: config.apiKey,
      model: config.model,
      system: SYSTEM_PROMPT,
      user: buildGenerationContext(plan),
      temperature: 0.35,
      maxTokens: 8192,
      timeoutSec: config.timeout,
      label: "官网 Prompt 生成",
    })

    const cleanedPrompt = stripCodeFence(prompt)
    if (!cleanedPrompt) {
      return NextResponse.json({ error: "通义千问未返回有效 Prompt，请重试" }, { status: 502 })
    }

    return NextResponse.json({ prompt: cleanedPrompt, model: config.model })
  } catch (error) {
    console.error("[website-prompt]", error)
    const message = error instanceof Error ? error.message : "未知错误"

    if (/401|api key|unauthorized/i.test(message)) {
      return NextResponse.json({ error: "通义千问 API Key 无效或无权限，请在后台管理页检查配置" }, { status: 401 })
    }
    if (/timeout|timed out|超时/i.test(message)) {
      return NextResponse.json({ error: "通义千问生成超时，请稍后重试或在后台增加模型超时时间" }, { status: 504 })
    }

    return NextResponse.json({ error: `官网 Prompt 生成失败：${message}` }, { status: 500 })
  }
}
