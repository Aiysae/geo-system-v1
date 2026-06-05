import { NextRequest, NextResponse } from "next/server"
import { openaiCompatChat } from "@/lib/llm/openai-compat"
import type { AnalyzeRequest, OptimizeRequest, AnalysisResult, OptimizeResult } from "@/types/aigc-detector"
import { API_PROVIDERS } from "@/types/geo-strategy"

export const runtime = "nodejs"
export const maxDuration = 300

function getApiUrl(provider: string, baseUrl: string): string {
  const prov = API_PROVIDERS.find(p => p.id === provider)
  if (provider === "custom" || !prov) {
    return baseUrl.replace(/\/$/, "") + "/v1/chat/completions"
  }
  return prov.baseUrl + prov.chatPath
}

const ANALYZE_SYSTEM_PROMPT = `你是一个专业的内容审核分析专家，擅长识别 AIGC（AI 生成内容）特征、营销软文特征，以及评估内容能否通过国内主流平台（搜狐、百家号、今日头条、知乎等）的审核。

你需要从以下三个维度分析文章：

## 1. AIGC 检测维度（aigcScore: 0-100，越高表示越像 AI 生成）
- 句式规整度：AI 倾向使用标准化、模板化句式
- 转折词/连接词滥用：过度使用"首先、其次、此外、综上所述"等
- 词汇单一性：反复使用相同词汇，缺乏同义词变化
- 段落结构模式化：总-分-总、并列等明显结构
- 情感表达机械：缺乏个人情感、体验细节
- 具体细节缺失：没有真实的时间、地点、人物等细节
- 过度使用形容词堆砌

## 2. 营销性质检测维度（marketingScore: 0-100，越高表示营销性越强）
- 品牌/产品词频：品牌名出现次数过多
- 引导性语言：过度使用"推荐"、"值得"、"必备"、"首选"等
- 价格/促销信息：频繁提及价格、折扣、优惠
- 行动号召（CTA）：强烈引导购买、下载、注册等
- 竞品对比：贬低竞品，过度美化自身产品
- 夸大用语：使用"最"、"第一"、"行业领先"等绝对化表述
- 联系方式/链接：包含微信、电话、链接等引流信息

## 3. 平台审核检测维度（approvalScore: 0-100，越高表示越可能通过审核）
- 软文/广告嫌疑：内容是否有明显商业推广意图
- 信息来源可信度：是否引用权威来源、数据
- 标题党倾向：标题是否夸张、与内容不符
- 敏感词/违禁词：是否包含政治、色情、暴力等敏感内容
- 内容原创性：是否像洗稿、抄袭
- 价值观导向：是否传递正向价值观
- 事实准确性：是否包含虚假信息

请严格按照以下 JSON 格式返回分析结果，不要包含任何其他内容：
{
  "aigcScore": <0-100的整数>,
  "marketingScore": <0-100的整数>,
  "approvalScore": <0-100的整数>,
  "aigcFeatures": ["具体的 AIGC 特征描述1", "具体的 AIGC 特征描述2", ...],
  "marketingIssues": ["具体的营销问题描述1", "具体的营销问题描述2", ...],
  "approvalRisks": ["具体的审核风险描述1", "具体的审核风险描述2", ...],
  "overallSuggestion": "综合建议，说明这篇文章的主要问题和改进方向"
}`

const OPTIMIZE_SYSTEM_PROMPT = `你是一个专业的内容优化专家，擅长将 AI 生成的营销软文改写成更自然、更容易通过平台审核的高质量内容。

用户会提供原文、分析结果和优化选项。请根据选项进行针对性优化：

## 优化原则

### 如果需要降低 AIGC 率 (reduceAigc)：
这是最重要的优化目标，必须大幅改写文章风格。请严格执行以下所有策略：

**1. 彻底删除 AI 特征词汇（必做）：**
- 删除所有"首先、其次、再次、最后、此外、另外、综上所述、总的来说、总而言之、值得一提的是、需要注意的是"
- 删除"然而、但是、不过"等频繁出现的转折词，或用更口语的"但"、"可"替代
- 删除"因此、所以、由此可见"等因果连接词
- 删除"一方面...另一方面"、"不仅...而且"等并列结构

**2. 句式大改造（必做）：**
- 把长句拆成短句，或把几个短句合成一个长句，制造长短不一的节奏
- 加入反问句："这不就是...吗？"、"谁不想...呢？"
- 加入感叹句和语气词："真的绝了！"、"太离谱了"、"说实话"、"讲真"
- 加入省略句和不完整句："懂的都懂"、"就很无语"
- 用破折号、省略号打断句子节奏

**3. 口语化和网络用语（必做）：**
- 用"搞"替代"进行"、"开展"
- 用"整"、"弄"、"搁"等口语动词
- 适当加入网络热词："yyds"、"绝绝子"、"芭比Q了"、"拿捏"、"属于是"（根据文章调性选用）
- 用"我觉得"、"我寻思"、"我琢磨"替代"笔者认为"
- 加入语气助词："啊"、"嘛"、"呢"、"吧"、"呗"

**4. 添加真人细节（必做）：**
- 虚构具体时间："去年冬天"、"上个月15号"、"前天晚上"
- 虚构具体场景："在公司茶水间"、"刷手机的时候"、"和朋友吃饭聊起来"
- 加入个人吐槽和小抱怨："本来以为...结果..."、"踩过坑才知道"
- 加入不相关的题外话或自嘲

**5. 打破段落规整性（必做）：**
- 段落长度要参差不齐：有的段落只有一句话，有的段落很长
- 删除明显的总-分-总结构
- 在段落之间加入过渡性的口语："说回正题"、"扯远了"、"话说回来"

**6. 制造"不完美"（必做）：**
- 重复使用某个词（真人会这样）
- 偶尔用错标点或少用标点
- 句子之间逻辑可以稍微跳跃
- 可以有一点点跑题再拉回来

### 如果需要弱化营销性质 (reduceMarketing)：
这是降低软文嫌疑的关键，必须让文章看起来像真实用户分享而非广告。

**1. 删除营销特征词（必做）：**
- 禁用词列表：推荐、强烈推荐、墙裂推荐、安利、种草、必买、必入、首选、不二之选、性价比之王、业界良心、断货王、爆款、神器、yyds（当用于推销时）
- 删除所有绝对化用语：最好、最佳、第一、唯一、无敌、完美、顶级、行业领先、遥遥领先
- 删除夸张形容：超级、巨、绝绝子、太香了、爱死了（当用于产品时）

**2. 品牌/产品处理：**
- 品牌名最多出现 1-2 次，其他用"这款"、"它"、"这个产品"替代
- 不要在开头和结尾提及品牌名
- 用品类名替代品牌名（如"这款洗面奶"而非"XX洗面奶"）

**3. 语气转换：**
- 将"推荐大家试试"改为"我自己用着还行"
- 将"一定要买"改为"可以考虑"
- 将"太好用了"改为"用起来还可以"
- 用疑问句替代肯定句："这个味道我挺喜欢的，不知道你们会不会喜欢"

**4. 添加客观内容：**
- 必须提及 1-2 个缺点或不足
- 加入"不适合XX人群"的说明
- 加入"也有人说..."的不同观点
- 加入价格对比或替代选择

**5. 删除行动引导（CTA）：**
- 删除：快去买、赶紧入手、链接在评论区、点击购买、私信我、关注我
- 删除：限时、优惠、折扣、活动、赠品等促销信息
- 删除：联系方式、微信号、店铺名

### 如果需要提升审核通过率 (improveApproval)：
- 删除敏感词和擦边表述
- 添加信息来源引用（可以引用公开数据）
- 让标题更加实在，避免标题党
- 确保内容有信息价值，不是纯粹广告
- 添加一些教育性、知识性内容
- 语气更加中立客观

### 如果需要保持核心观点 (preserveCore)：
- 确保原文的主要信息点都保留
- 产品/服务的核心优势要体现
- 保持文章的主题和方向不变

请返回以下 JSON 格式，不要包含任何其他内容：
{
  "optimizedContent": "优化后的完整文章内容",
  "changes": ["主要修改说明1", "主要修改说明2", ...]
}`

export async function POST(request: NextRequest) {
  const url = new URL(request.url)
  const action = url.searchParams.get("action") || "analyze"

  try {
    if (action === "analyze") {
      const body = await request.json() as AnalyzeRequest
      const { content, apiConfig } = body

      if (!content || content.trim().length < 10) {
        return NextResponse.json({ error: "文章内容太短，请输入至少 10 个字符" }, { status: 400 })
      }

      const apiUrl = getApiUrl(apiConfig.provider, apiConfig.baseUrl)

      const response = await openaiCompatChat({
        url: apiUrl,
        apiKey: apiConfig.apiKey,
        model: apiConfig.model,
        system: ANALYZE_SYSTEM_PROMPT,
        user: `请分析以下文章：\n\n${content}`,
        temperature: 0.3,
        maxTokens: 2048,
        jsonMode: true,
        label: "AIGC-Detector",
      })

      let result: AnalysisResult
      try {
        const cleaned = response.replace(/```json\n?|\n?```/g, "").trim()
        result = JSON.parse(cleaned)
      } catch {
        return NextResponse.json({ error: "分析结果解析失败，请重试" }, { status: 500 })
      }

      return NextResponse.json(result)

    } else if (action === "optimize") {
      const body = await request.json() as OptimizeRequest
      const { content, options, analysisResult, apiConfig } = body

      if (!content || content.trim().length < 10) {
        return NextResponse.json({ error: "文章内容太短" }, { status: 400 })
      }

      const apiUrl = getApiUrl(apiConfig.provider, apiConfig.baseUrl)

      const optionDescriptions: string[] = []
      if (options.improveApproval) optionDescriptions.push("提升平台审核通过率")
      if (options.preserveCore) optionDescriptions.push("保持原文核心观点")

      const aigcIntensityMap = {
        light: "轻度改写（保持原文风格，仅删除明显AI特征词）",
        medium: "中度改写（调整句式结构，增加口语化表达）",
        aggressive: "激进改写（大幅重写，完全模拟真人写作风格，可使用网络用语）"
      }

      const marketingIntensityMap = {
        light: "轻度弱化（仅删除明显广告词，保留产品介绍）",
        medium: "中度弱化（减少品牌露出，转为经验分享风格）",
        aggressive: "激进弱化（完全去除推销感，转为纯用户视角）"
      }

      let aigcInstruction = ""
      if (options.reduceAigc) {
        aigcInstruction = `
## 【重要】降低 AIGC 率 - ${aigcIntensityMap[options.aigcIntensity || "medium"]}

当前 AIGC 率高达 ${analysisResult.aigcScore}%，必须大幅降低！请严格执行以下改写策略：

1. **删除所有 AI 特征词**（这是最基本的要求）：
   - 禁用词列表：首先、其次、再次、最后、此外、另外、综上所述、总的来说、总而言之、值得一提的是、需要注意的是、然而、因此、所以、由此可见、一方面、另一方面、不仅、而且、同时、进而、从而
   - 用更自然的表达替代，或直接删除这些连接词

2. **句式必须变化**：
   - 长句拆短，短句合并，制造参差感
   - 加入反问："这不就是...？"、"谁还不知道...？"
   - 加入感叹和语气词："真的！"、"说实话"、"讲真"、"我觉得吧"
   ${options.aigcIntensity === "aggressive" ? '- 可以用网络热词：yyds、绝了、拿捏、属于是、芭比Q' : ''}

3. **加入真人细节**：
   ${options.addPersonalStory ? '- 必须添加1-2个虚构的个人经历或场景（如"上周我..."、"之前朋友推荐..."）' : '- 适当加入主观感受和个人观点'}
   - 可以有小吐槽、小抱怨、自嘲
   - 加入具体时间地点（虚构即可）

4. **打破段落结构**：
   - 段落长短要不一致
   - 删除总-分-总的规整结构
   - 可以稍微跑题再拉回来

${options.useSlang ? '5. **使用口语和俚语**：\n   - 用"搞、整、弄"替代"进行、开展"\n   - 用"我觉得、我寻思"替代"笔者认为"\n   - 加入语气词：啊、嘛、呢、吧、呗' : ''}
`
      }

      let marketingInstruction = ""
      if (options.reduceMarketing) {
        marketingInstruction = `
## 【重要】降低营销性质 - ${marketingIntensityMap[options.marketingIntensity || "medium"]}

当前营销性质高达 ${analysisResult.marketingScore}%，必须让文章看起来像真实用户分享！

1. **删除营销特征词**（必做）：
   - 禁用词列表：推荐、强烈推荐、墙裂推荐、安利、种草、必买、必入、首选、不二之选、性价比之王、业界良心、断货王、爆款、神器
   - 删除绝对化用语：最好、最佳、第一、唯一、无敌、完美、顶级、行业领先、遥遥领先
   ${options.marketingIntensity === "aggressive" ? '- 删除所有带有推销意图的形容词' : ''}

2. **品牌/产品处理**：
   ${options.removeBrandMention ? '- 品牌名最多出现1次，其他全部用"这款"、"它"替代\n   - 开头结尾禁止出现品牌名' : '- 适当减少品牌名出现频次'}

3. **语气转换**：
   - "推荐大家试试" → "我自己用着还行"
   - "一定要买" → "可以考虑"
   - "太好用了" → "用起来还可以"
   - 多用疑问和不确定语气

4. **添加客观内容**（${options.addObjectiveView ? '必做' : '建议'}）：
   ${options.addObjectiveView ? '- 必须提及1-2个缺点或不足\n   - 加入"不适合XX人群"的说明\n   - 加入"也有人说..."的不同观点' : '- 适当加入一些客观评价'}

5. **删除行动引导CTA**（${options.removeCTA ? '必做' : '建议'}）：
   ${options.removeCTA ? '- 删除所有：快去买、赶紧入手、链接在评论区、点击购买、私信我、关注我\n   - 删除所有促销信息：限时、优惠、折扣、活动、赠品\n   - 删除所有联系方式' : '- 弱化购买引导'}
`
      }

      const userPrompt = `## 原文
${content}

## 当前分析结果
- AIGC 率：${analysisResult.aigcScore}%（目标：降到 30% 以下）
- 营销性质：${analysisResult.marketingScore}%（目标：降到 30% 以下）
- 审核通过预估：${analysisResult.approvalScore}%
- 检测到的 AIGC 特征：${analysisResult.aigcFeatures.join("；")}
- 营销问题：${analysisResult.marketingIssues.join("；")}
- 审核风险：${analysisResult.approvalRisks.join("；")}
${aigcInstruction}${marketingInstruction}
## 其他优化要求
${optionDescriptions.length > 0 ? optionDescriptions.join("、") : "无"}

请根据以上要求彻底改写文章。`

      const response = await openaiCompatChat({
        url: apiUrl,
        apiKey: apiConfig.apiKey,
        model: apiConfig.model,
        system: OPTIMIZE_SYSTEM_PROMPT,
        user: userPrompt,
        temperature: 0.7,
        maxTokens: 4096,
        jsonMode: true,
        label: "AIGC-Optimizer",
      })

      let result: OptimizeResult
      try {
        const cleaned = response.replace(/```json\n?|\n?```/g, "").trim()
        result = JSON.parse(cleaned)
      } catch {
        return NextResponse.json({ error: "优化结果解析失败，请重试" }, { status: 500 })
      }

      return NextResponse.json(result)

    } else {
      return NextResponse.json({ error: "未知操作" }, { status: 400 })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误"
    console.error("[AIGC-Detector] Error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
