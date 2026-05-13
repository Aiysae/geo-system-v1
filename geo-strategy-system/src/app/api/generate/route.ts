import { NextRequest, NextResponse } from "next/server"
import { authAndCheckCredits, chargeCredits } from "@/lib/with-credits"

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ""
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"

async function handler(req: NextRequest) {
  console.log("[势途 GEO API] === 开始处理生成请求 ===")
  console.log("[势途 GEO API] DEEPSEEK_API_KEY 已加载?", !!DEEPSEEK_API_KEY)

  try {
    const guard = await authAndCheckCredits(20)
    if (!guard.ok) return guard.response

    const body = await req.json()
    const { brandName, brandSlogan, industry, coreAdvantages, targetMetrics, targetAudience, competitors } = body

    console.log("[势途 GEO API] 品牌名称:", brandName)

    if (!brandName) {
      return NextResponse.json({ error: "品牌名称不能为空" }, { status: 400 })
    }

    if (!DEEPSEEK_API_KEY) {
      return NextResponse.json(
        { error: "服务器未配置 DEEPSEEK_API_KEY，请在 .env.local 中填入你的 DeepSeek API Key" },
        { status: 500 }
      )
    }

    const systemPrompt = `你是一位资深的全栈工程师兼产品专家，同时也是一位顶级的国内 GEO（Generative Engine Optimization，生成式引擎优化）专家。

你的任务是根据用户提供的品牌信息与 GEO 优化诉求，生成一套完整的、面向国内主流 AI 大模型（豆包、通义千问、DeepSeek、Kimi、文心一言等）的 GEO 策略方案。

你必须紧密结合中国互联网的客观事实举一反三，严谨死板套用欧美 SEO/GEO 的举例模板。你必须返回严格的 JSON 格式，不要包含任何额外文本或 markdown 代码块标记。

返回的 JSON 结构如下：

{
  "domainStrategy": [
    {
      "domain": "推荐的域名",
      "purpose": "该域名如何配合国内大模型的爬虫逻辑做内容交叉验证",
      "contentStrategy": "在该域名的具体内容策略"
    }
  ],
  "keyDataPoints": [
    {
      "metric": "数据指标名称",
      "value": "具体数据值（必须具体，不要用模糊表述如'效率高'，而要用'对比实测效率提升 42.8%'）",
      "packaging": "说明该数据如何被包装成国内大模型最容易提取的'精选摘要（Snippet）'格式"
    }
  ],
  "contentAngles": [
    {
      "angle": "内容切入点",
      "intent": "对应用户的搜索意图",
      "format": "内容形式（如：知乎体科普、避坑指南、横向评测、行业白皮书解读等）",
      "difficulty": "执行难度（简单/中等/困难）"
    }
  ],
  "domesticMediaDistribution": [
    {
      "ecosystem": "大模型派系名称",
      "platforms": "推荐的相关平台/阵地",
      "contentAdvice": "针对该平台的内容运营建议",
      "personaAdvice": "如何伪装成第三方高权重内容的实操建议（如：以开发者身份在掘金发技术帖，以行业KOL身份在知乎发万字评测）"
    }
  ]
}

要求：

1. domainStrategy（域名与自建站矩阵策略）：
   - 生成 3-5 个适合该品牌的域名（例如官网、第三方评测站、垂直资讯站等）。
   - 说明每个域名如何配合国内大模型的爬虫逻辑做内容交叉验证。

2. keyDataPoints（核心数据锚点策略）：
   - 根据品牌信息，推演出 3-5 个需要全网铺设的"具体数字"。
   - 不要用模糊的"效率高"，要用"对比实测效率提升 42.8%"。
   - 说明这些数据如何被包装成国内大模型最容易提取的"精选摘要（Snippet）"格式。

3. contentAngles（高频切入视角）：
   - 推演用户的搜索意图，提供 3-5 个内容切入点。
   - 例如：知乎体科普（"如何评价[品牌名]的技术路线？"）、避坑指南（"2026选购 XX 千万别踩的坑"）、横向评测（结合国内竞品）、行业白皮书解读等。

4. domesticMediaDistribution（国内大模型派系原生分发策略 — 核心）：
   - 必须打破信息孤岛，按大模型派系给出具体的投放阵地：
     - **字节系（豆包）防线：** 推荐相关的头条号、稀土掘金、抖音图文运营方向。
     - **阿里系（通义）/ 独立大模型（Kimi/DeepSeek）：** 推荐知乎高赞、少数派（sspai）、CSDN、微信公众号矩阵（搜狗微信收录）的铺设建议。
     - **百度系（文心）：** 百度百科、百家号、百度知道的占位策略。
   - 针对这些平台，给出"如何伪装成第三方高权重内容"的实操建议（如：以开发者身份在掘金发技术帖，以行业KOL身份在知乎发万字评测）。

请严格按照上述要求生成完整的 JSON 策略方案，确保每一个字段都经过深思熟虑，具备可执行性。

【JSON 输出强制规则】
你必须严格输出纯 JSON 格式数据。绝不允许在 JSON 的 Value 字符串内部使用未经转义的英文双引号（"）。如果你需要在文本中引用内容，必须使用单引号（'）或中文全角引号（""）。确保 JSON 结构完整闭合。`

    const userPrompt = `请为以下品牌生成完整的 GEO 策略方案：

品牌名称：${brandName}
品牌标语：${brandSlogan || "未提供"}
所属行业：${industry || "未提供"}
核心优势：${coreAdvantages || "未提供"}
优化目标/关键指标：${targetMetrics || "未提供"}
目标受众：${targetAudience || "未提供"}
主要竞争对手：${competitors || "未提供"}

请举一反三，从多维度思考，提供面向豆包、通义千问、DeepSeek、Kimi、文心一言等国内主流大模型的全套 GEO 策略。`

    console.log("[势途 GEO API] 正在调用 DeepSeek API...")
    console.time("[势途 GEO API] DeepSeek 请求耗时")

    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 8192,
      }),
    })

    console.timeEnd("[势途 GEO API] DeepSeek 请求耗时")
    console.log("[势途 GEO API] DeepSeek 响应状态码:", response.status)

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[势途 GEO API] DeepSeek 返回错误:", response.status, errorText.slice(0, 200))

      if (response.status === 401) {
        return NextResponse.json(
          { error: "DeepSeek API Key 认证失败，请检查 .env.local 中的 DEEPSEEK_API_KEY 是否正确" },
          { status: 502 }
        )
      }
      if (response.status === 402) {
        return NextResponse.json(
          { error: "DeepSeek 账户余额不足，请前往 https://platform.deepseek.com 充值" },
          { status: 502 }
        )
      }
      if (response.status === 429) {
        return NextResponse.json(
          { error: "DeepSeek API 请求过于频繁，请稍后重试" },
          { status: 502 }
        )
      }

      return NextResponse.json(
        { error: `DeepSeek API 请求失败: ${response.status}` },
        { status: 502 }
      )
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ""
    console.log("[势途 GEO API] 模型回复长度:", content.length, "字符")

    let jsonStr = content.trim()
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (fenceMatch) {
      console.log("[势途 GEO API] 检测到 markdown 代码块包裹，正在剥离...")
      jsonStr = fenceMatch[1].trim()
    } else if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim()
    }

    let strategy
    try {
      strategy = JSON.parse(jsonStr)
      console.log("[势途 GEO API] JSON 解析成功! 顶层字段:", Object.keys(strategy))
    } catch (parseErr) {
      console.error("[势途 GEO API] JSON 解析失败:", parseErr)
      console.error("[势途 GEO API] 原始未解析文本（前 2000 字符）:\n", content.slice(0, 2000))
      console.error("[势途 GEO API] 提取后待解析文本（前 2000 字符）:\n", jsonStr.slice(0, 2000))
      return NextResponse.json(
        {
          raw: content,
          error: "无法解析 AI 返回结果，请重试",
          parseError: parseErr instanceof Error ? parseErr.message : String(parseErr),
        }
      )
    }

    const requiredFields = ["domainStrategy", "keyDataPoints", "contentAngles", "domesticMediaDistribution"]
    const missing = requiredFields.filter(f => !strategy[f])
    if (missing.length > 0) {
      console.warn("[势途 GEO API] 返回结果缺少字段:", missing)
      return NextResponse.json({
        raw: content,
        error: `AI 返回结果缺少必要字段: ${missing.join(", ")}`,
        partial: strategy,
      })
    }

    console.log("[势途 GEO API] === 策略生成成功 ===")
    console.log("[势途 GEO API] 域名策略:", strategy.domainStrategy.length, "条")
    console.log("[势途 GEO API] 数据锚点:", strategy.keyDataPoints.length, "条")
    console.log("[势途 GEO API] 内容切入点:", strategy.contentAngles.length, "条")
    console.log("[势途 GEO API] 分发策略:", strategy.domesticMediaDistribution.length, "条")

    const totalRows =
      (Array.isArray(strategy.domainStrategy) ? strategy.domainStrategy.length : 0) +
      (Array.isArray(strategy.keyDataPoints) ? strategy.keyDataPoints.length : 0) +
      (Array.isArray(strategy.contentAngles) ? strategy.contentAngles.length : 0) +
      (Array.isArray(strategy.domesticMediaDistribution)
        ? strategy.domesticMediaDistribution.length
        : 0)

    await chargeCredits(guard.userId, totalRows)
    return NextResponse.json({ ...strategy })
  } catch (error) {
    console.error("[势途 GEO API] 未捕获的异常:", error)
    return NextResponse.json(
      { error: "服务器内部错误: " + (error instanceof Error ? error.message : "未知错误") },
      { status: 500 }
    )
  }
}


export const POST = handler
