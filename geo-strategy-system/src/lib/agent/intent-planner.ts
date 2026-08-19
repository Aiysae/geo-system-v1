import type { AgentActionName, AgentModuleKey } from "@/types/agent"

export type AgentPlannerClient = {
  id: string
  name: string
  ourBrand?: string
  aliases?: string[]
  subjectType?: "brand" | "person"
  teamId?: string
}

export type AgentWorkflowRisk = "read_only" | "low" | "billable" | "destructive"

type IntentRule = {
  pattern: RegExp
  weight: number
}

export type AgentWorkflowDefinition = {
  key: string
  title: string
  description: string
  module: AgentModuleKey
  actions: AgentActionName[]
  supportingTools: string[]
  requiredInputs: string[]
  requiresClient: boolean
  requiresLiveWeb?: boolean
  risk: AgentWorkflowRisk
  expectedExecution: "immediate" | "background"
  examples: string[]
  rules: IntentRule[]
  negativeRules?: RegExp[]
}

export type AgentWorkflowMatch = Omit<AgentWorkflowDefinition, "rules" | "negativeRules"> & {
  score: number
  confidence: number
  unavailableActions: AgentActionName[]
}

export type AgentClientResolution = {
  status: "not_required" | "resolved" | "needs_clarification" | "not_found"
  clientId?: string
  clientName?: string
  teamId?: string
  subjectType?: "brand" | "person"
  reason: string
  candidates: Array<{
    id: string
    name: string
    ourBrand?: string
    teamId?: string
  }>
}

export type AgentRequestPlan = {
  request: string
  primaryWorkflow: AgentWorkflowMatch
  alternatives: AgentWorkflowMatch[]
  clientResolution: AgentClientResolution
  inferredParameters: Record<string, unknown>
  missingInformation: string[]
  clarificationQuestions: string[]
  executionPolicy: {
    mustDryRunFirst: boolean
    requiresConfirmation: boolean
    canAutoExecute: boolean
    reason: string
  }
}

const WORKFLOWS: AgentWorkflowDefinition[] = [
  workflow({
    key: "publishing_plan_delete",
    title: "删除发布规划草稿",
    description: "定位指定客户的草稿并在人工确认后删除。",
    module: "keyword",
    actions: ["publishing.plan.get", "publishing.plan.delete"],
    supportingTools: ["shitu_list_clients"],
    requiredInputs: ["客户", "发布规划 ID"],
    risk: "destructive",
    expectedExecution: "immediate",
    examples: ["把这个客户的发布规划草稿删掉"],
    rules: [
      { pattern: /(删除|删掉|移除).{0,8}(发布|发文).{0,6}(规划|计划|草稿)/i, weight: 24 },
      { pattern: /(发布|发文).{0,6}(规划|计划|草稿).{0,8}(删除|删掉|移除)/i, weight: 24 },
    ],
  }),
  workflow({
    key: "penetration_check",
    title: "AI 渗透率联网检测",
    description: "使用已授权模型对原始疑问句进行独立联网检测并生成可审计结果。",
    module: "penetration",
    actions: ["penetration.run"],
    supportingTools: ["shitu_list_clients", "shitu_get_client", "shitu_get_task_result"],
    requiredInputs: ["客户", "疑问句", "检测模型"],
    requiresLiveWeb: true,
    risk: "billable",
    expectedExecution: "background",
    examples: ["看看这个品牌在 AI 里有没有被推荐", "给张医生做一次渗透率检测"],
    rules: [
      { pattern: /渗透率|疑问句检测|联网回答审计/i, weight: 15 },
      { pattern: /(AI|大模型).{0,12}(推荐|提及|知道|收录|声量)/i, weight: 11 },
      { pattern: /(有没有|是否).{0,8}(被)?(推荐|提及|收录)/i, weight: 8 },
      { pattern: /联网(核验|检测|回答|搜索)/i, weight: 5 },
    ],
  }),
  workflow({
    key: "penetration_question_generation",
    title: "生成精准检测疑问句",
    description: "按问题意图生成用于渗透率检测的疑问句。",
    module: "penetration",
    actions: ["penetration.questions.generate"],
    supportingTools: ["shitu_list_clients", "shitu_get_client"],
    requiredInputs: ["客户", "行业", "问题意图", "数量"],
    risk: "billable",
    expectedExecution: "background",
    examples: ["给这个客户生成 30 个检测问题"],
    rules: [
      { pattern: /(生成|智能生成).{0,8}(检测)?(疑问句|问题池|问题)/i, weight: 13 },
      { pattern: /问题意图/i, weight: 7 },
    ],
  }),
  workflow({
    key: "penetration_automation",
    title: "自动渗透率监测",
    description: "读取或设置定时检测、下降阈值与提醒。",
    module: "penetration",
    actions: ["penetration.automation.get", "penetration.automation.save"],
    supportingTools: ["shitu_list_clients"],
    requiredInputs: ["客户", "检测间隔", "执行时间"],
    risk: "low",
    expectedExecution: "immediate",
    examples: ["每两天晚上八点自动测一次"],
    rules: [
      { pattern: /(自动|定时|每天|隔\s*[1-7一二三四五六七]天).{0,12}(渗透率|疑问句|检测|监测)/i, weight: 18 },
      { pattern: /(下降|下跌).{0,8}(提醒|告警|通知)/i, weight: 8 },
    ],
  }),
  workflow({
    key: "website_diagnosis",
    title: "AI 可读性网站诊断",
    description: "真实抓取网站并检查 E-E-A-T、标题结构、Q&A、robots.txt 与 llms.txt。",
    module: "diagnosis",
    actions: ["diagnosis.run"],
    supportingTools: ["shitu_list_clients", "shitu_get_client", "shitu_get_task_result"],
    requiredInputs: ["客户", "网站地址"],
    requiresLiveWeb: true,
    risk: "billable",
    expectedExecution: "background",
    examples: ["这个官网为什么不容易被 AI 看懂"],
    rules: [
      { pattern: /(网站|官网|页面).{0,12}(AI|爬虫|抓取|收录|看懂|可读|诊断)/i, weight: 16 },
      { pattern: /H1|H2|robots\.txt|llms\.txt|E-?E-?A-?T|Q&A/i, weight: 7 },
    ],
  }),
  workflow({
    key: "difficulty_assessment",
    title: "GEO 难度与成本测评",
    description: "评估行业或品牌的 GEO 难度、周期、内容量和执行成本。",
    module: "difficulty",
    actions: ["difficulty.run"],
    supportingTools: ["shitu_list_clients", "shitu_get_client", "shitu_get_task_result"],
    requiredInputs: ["客户", "行业", "区域"],
    requiresLiveWeb: true,
    risk: "billable",
    expectedExecution: "background",
    examples: ["做这个行业的 GEO 要多少钱、多少天"],
    rules: [
      { pattern: /(GEO)?.{0,4}(难度|难不难|测评|评分)/i, weight: 10 },
      { pattern: /(需要|大概|要).{0,6}(多少钱|多少天|多少篇|成本|周期)/i, weight: 9 },
    ],
  }),
  workflow({
    key: "competitor_research",
    title: "联网竞品对比",
    description: "强制联网调研目标与竞品，并保留可核验来源。",
    module: "research",
    actions: ["research.compare"],
    supportingTools: ["shitu_list_clients", "shitu_get_client", "shitu_get_task_result"],
    requiredInputs: ["客户", "竞品"],
    requiresLiveWeb: true,
    risk: "billable",
    expectedExecution: "background",
    examples: ["把我们和这三个竞品做一次对比"],
    rules: [
      { pattern: /竞品(对比|比较|分析)|(对比|比较).{0,8}竞品/i, weight: 18 },
      { pattern: /和.{1,20}比(一下|较|对)/i, weight: 6 },
    ],
  }),
  workflow({
    key: "independent_research",
    title: "联网独立调研",
    description: "基于公开网络信息完成行业、品牌或个人 IP 调研。",
    module: "research",
    actions: ["research.run"],
    supportingTools: ["shitu_list_clients", "shitu_get_client", "shitu_get_task_result"],
    requiredInputs: ["客户", "调研目标"],
    requiresLiveWeb: true,
    risk: "billable",
    expectedExecution: "background",
    examples: ["帮我调研这个行业现在的情况"],
    rules: [
      { pattern: /独立调研|行业调研|市场调研|调研报告/i, weight: 15 },
      { pattern: /(查|了解|调研).{0,8}(行业|市场|品牌|人物)/i, weight: 7 },
    ],
  }),
  workflow({
    key: "keyword_strategy",
    title: "GEO 关键词策略与疑问句池",
    description: "从客户资料到关键词、优势、策略和疑问句池的完整工作流。",
    module: "keyword",
    actions: ["keyword.extract", "keyword.advantages", "keyword.strategy.run", "keyword.questions.run"],
    supportingTools: ["shitu_list_clients", "shitu_get_client", "shitu_get_task_result"],
    requiredInputs: ["客户", "品牌资料"],
    requiresLiveWeb: true,
    risk: "billable",
    expectedExecution: "background",
    examples: ["给这个客户做关键词策略和问题池"],
    rules: [
      { pattern: /关键词策略|关键词规划/i, weight: 17 },
      { pattern: /(疑问句|问题)池/i, weight: 9 },
      { pattern: /(关键词|疑问句).{0,8}(优势|策略)/i, weight: 7 },
    ],
  }),
  workflow({
    key: "publishing_plan",
    title: "平台发文配额与排期",
    description: "根据预算、平台权重、账号数和单账号日上限生成可执行规划。",
    module: "keyword",
    actions: ["publishing.plan.get", "publishing.plan.recommend", "publishing.plan.create"],
    supportingTools: ["shitu_list_clients", "shitu_get_client"],
    requiredInputs: ["客户", "服务周期", "预算", "平台与账号容量"],
    risk: "low",
    expectedExecution: "immediate",
    examples: ["给这个客户做三个月的平台发文规划"],
    rules: [
      { pattern: /(发文|发布).{0,8}(规划|配额|排期|账号上限)/i, weight: 17 },
      { pattern: /(平台|账号).{0,8}(日上限|每天|发多少)/i, weight: 8 },
    ],
  }),
  workflow({
    key: "daily_content_production",
    title: "按发布规划生成今日内容",
    description: "读取已生效的发文配额，按平台生成对应数量文章并分目录打包。",
    module: "article",
    actions: ["publishing.plan.get", "publishing.tasks.list", "article.production.run", "article.production.get"],
    supportingTools: ["shitu_list_clients", "shitu_get_task_result", "shitu_get_content_production_zip"],
    requiredInputs: ["客户", "生产日期"],
    risk: "billable",
    expectedExecution: "background",
    examples: ["按今天的发文配额生成文章并分平台打包"],
    rules: [
      { pattern: /(按|根据).{0,10}(发文|发布).{0,6}(规划|配额|任务).{0,10}(生成|生产|写)/i, weight: 22 },
      { pattern: /(今天|当日|每日).{0,10}(发文|发布|文章)/i, weight: 8 },
      { pattern: /(分平台|搜狐|知乎).{0,8}(打包|下载|生成)/i, weight: 7 },
    ],
  }),
  workflow({
    key: "article_rewrite",
    title: "链接文章改写",
    description: "提取原文、判断主要品牌并按顺序完成可审计改写。",
    module: "article",
    actions: ["article.source.extract", "article.brands.analyze", "article.rewrite"],
    supportingTools: ["shitu_list_clients", "shitu_get_client", "shitu_get_task_result"],
    requiredInputs: ["客户", "原文链接或原文", "目标品牌及资料"],
    risk: "billable",
    expectedExecution: "background",
    examples: ["把这篇链接的文章换成我们的三个品牌"],
    rules: [
      { pattern: /改写|重写|原文链接|替换.{0,6}品牌/i, weight: 15 },
      { pattern: /(读取|提取).{0,8}(文章|链接|原文)/i, weight: 7 },
    ],
  }),
  workflow({
    key: "article_batch",
    title: "批量文章生成",
    description: "将每个疑问句与匹配优势作为独立任务批量生成。",
    module: "article",
    actions: ["article.strategy.plan", "article.batch.run"],
    supportingTools: ["shitu_list_clients", "shitu_get_article_settings", "shitu_get_article_batch"],
    requiredInputs: ["客户", "疑问句与优势", "文章类型"],
    risk: "billable",
    expectedExecution: "background",
    examples: ["把这 100 个问题一个问题生成一篇文章"],
    rules: [
      { pattern: /批量.{0,8}(生成|写).{0,4}文章|(生成|写).{0,4}\d+\s*篇/i, weight: 16 },
      { pattern: /一个(疑问句|问题).{0,8}一篇/i, weight: 10 },
    ],
  }),
  workflow({
    key: "article_generation",
    title: "生成单篇文章",
    description: "选择合适 Prompt 与模型生成单篇 Markdown 文章。",
    module: "article",
    actions: ["article.generate"],
    supportingTools: ["shitu_list_clients", "shitu_get_article_settings", "shitu_get_task_result"],
    requiredInputs: ["客户", "文章主题", "文章类型"],
    risk: "billable",
    expectedExecution: "background",
    examples: ["写一篇选型指南"],
    rules: [
      { pattern: /(写|生成|创作).{0,8}(一篇|篇).{0,6}(文章|稿件|文案)/i, weight: 10 },
      { pattern: /第三方测评|行业排名|选型指南|TOP\s*榜/i, weight: 5 },
    ],
  }),
  workflow({
    key: "article_media",
    title: "文章批量插图与导出",
    description: "上传图片后按固定脚本批量插入已生成文章并导出。",
    module: "article",
    actions: ["article.media.upload", "article.media.run"],
    supportingTools: ["shitu_list_article_batches", "shitu_get_article_batch_zip"],
    requiredInputs: ["客户", "文章批次", "图片", "插图脚本"],
    risk: "billable",
    expectedExecution: "background",
    examples: ["给这批文章统一插入图片再打包"],
    rules: [
      { pattern: /(批量|文章).{0,8}(插图|配图|图片)/i, weight: 16 },
      { pattern: /带图片.{0,6}(导出|打包|下载)/i, weight: 8 },
    ],
  }),
  workflow({
    key: "feedback_action",
    title: "录入执行动作",
    description: "单条或批量记录发布、建站、诊断等执行证据。",
    module: "feedback",
    actions: ["feedback.action.create"],
    supportingTools: ["shitu_list_clients", "shitu_get_feedback"],
    requiredInputs: ["客户", "动作日期", "标题或证据网址"],
    risk: "low",
    expectedExecution: "immediate",
    examples: ["记录今天发了 5 篇搜狐文章"],
    rules: [
      { pattern: /(记录|录入|导入).{0,8}(动作|执行|证据|发布链接)/i, weight: 15 },
      { pattern: /执行反馈/i, weight: 5 },
    ],
  }),
  workflow({
    key: "feedback_report",
    title: "生成周报或月报",
    description: "选择时间范围和历史渗透率基线，生成可分享报告链接。",
    module: "feedback",
    actions: ["feedback.report.options", "feedback.report.create", "feedback.report.manage"],
    supportingTools: ["shitu_list_clients", "shitu_get_feedback"],
    requiredInputs: ["客户", "周报或月报", "报告截止日期"],
    risk: "low",
    expectedExecution: "immediate",
    examples: ["整理最近一个月的动作并生成客户可打开的链接"],
    rules: [
      { pattern: /周(报|反馈)|月(报|反馈)|周反馈|月反馈/i, weight: 16 },
      { pattern: /(最近|过去|往前).{0,6}(7|七|一周|30|三十|一个月).{0,8}(动作|报告|反馈)/i, weight: 9 },
      { pattern: /(客户|对外).{0,8}(查看|打开|分享).{0,4}(报告|链接)/i, weight: 6 },
    ],
  }),
  workflow({
    key: "knowledge_import",
    title: "导入客户资料库",
    description: "上传文档或表格，解析为待审核的事实候选项后再入库。",
    module: "client",
    actions: ["knowledge.import", "knowledge.commit"],
    supportingTools: ["shitu_list_clients", "shitu_list_knowledge_imports", "shitu_get_knowledge_import"],
    requiredInputs: ["客户", "资料文件"],
    risk: "low",
    expectedExecution: "background",
    examples: ["把这个 Excel 导入客户资料库"],
    rules: [
      { pattern: /(资料库|知识库).{0,8}(上传|导入|补充)/i, weight: 15 },
      { pattern: /(文档|Excel|表格|PDF).{0,8}(解析|导入|资料库)/i, weight: 9 },
    ],
  }),
  workflow({
    key: "professional_report",
    title: "生成专业可视化报告",
    description: "从渗透率情报、独立调研、AI 诊断或难度测评生成 PDF 报告。",
    module: "report",
    actions: ["report.create"],
    supportingTools: ["shitu_list_clients", "shitu_list_outputs", "shitu_list_reports"],
    requiredInputs: ["客户", "报告模块"],
    risk: "billable",
    expectedExecution: "background",
    examples: ["把这次渗透率结果导出成专业 PDF"],
    rules: [
      { pattern: /专业报告|可视化报告|导出.{0,6}PDF|PDF.{0,6}报告/i, weight: 15 },
      { pattern: /(渗透率|调研|诊断|难度).{0,8}报告/i, weight: 7 },
    ],
  }),
  workflow({
    key: "capability_discovery",
    title: "了解势途 GEO 能力",
    description: "按业务模块说明 Agent 能做什么、需要什么输入以及会产出什么。",
    module: "client",
    actions: [],
    supportingTools: ["shitu_plan_request", "shitu_list_clients"],
    requiredInputs: [],
    requiresClient: false,
    risk: "read_only",
    expectedExecution: "immediate",
    examples: ["这个系统能做什么", "帮我选择合适的功能"],
    rules: [
      { pattern: /(有|支持|包含).{0,6}(什么|哪些).{0,4}(功能|能力|模块)/i, weight: 14 },
      { pattern: /(怎么|如何).{0,6}(用|操作|开始)/i, weight: 6 },
    ],
  }),
]

export const AGENT_WORKFLOW_SUMMARIES = WORKFLOWS.map(item => ({
  key: item.key,
  title: item.title,
  description: item.description,
  module: item.module,
  actions: item.actions,
  supportingTools: item.supportingTools,
  requiredInputs: item.requiredInputs,
  requiresLiveWeb: item.requiresLiveWeb === true,
  risk: item.risk,
  expectedExecution: item.expectedExecution,
  examples: item.examples,
}))

export function planAgentRequest(input: {
  request: string
  clientHint?: string
  clients?: AgentPlannerClient[]
  availableActions?: readonly AgentActionName[]
}): AgentRequestPlan {
  const request = String(input.request || "").trim().slice(0, 4_000)
  if (!request) throw new Error("请提供需要规划的用户需求")
  const available = input.availableActions ? new Set(input.availableActions) : null
  const scored = WORKFLOWS.map(definition => {
    const score = workflowScore(definition, request)
    const unavailableActions = available
      ? definition.actions.filter(action => !available.has(action))
      : []
    return workflowMatch(definition, score, unavailableActions)
  }).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN"))
  const fallback = scored.find(item => item.key === "capability_discovery") || scored[0]
  const primaryWorkflow = scored[0]?.score > 0 ? scored[0] : fallback
  const alternatives = scored
    .filter(item => item.key !== primaryWorkflow.key && item.score > 0)
    .slice(0, 3)
  const clientResolution = resolveClient({
    request,
    clientHint: input.clientHint,
    clients: input.clients || [],
    required: primaryWorkflow.requiresClient,
  })
  const inferredParameters = inferParameters(request, clientResolution)
  const missingInformation = primaryWorkflow.requiredInputs.filter(label => (
    label === "客户"
      ? clientResolution.status !== "resolved" && clientResolution.status !== "not_required"
      : !parameterAppearsAvailable(label, request, inferredParameters)
  ))
  const clarificationQuestions: string[] = []
  if (clientResolution.status === "needs_clarification") {
    clarificationQuestions.push(`请确认要操作哪个客户：${clientResolution.candidates.map(item => item.name).join("、")}`)
  } else if (clientResolution.status === "not_found") {
    clarificationQuestions.push("未找到匹配的客户，请提供客户名称或先查看已授权客户列表。")
  }
  if (primaryWorkflow.confidence < 0.68 && alternatives.length > 0) {
    clarificationQuestions.push(`您更接近“${primaryWorkflow.title}”，还是“${alternatives[0].title}”？`)
  }
  const requiresConfirmation = primaryWorkflow.risk === "destructive"
  const mustDryRunFirst = primaryWorkflow.actions.length > 0 && primaryWorkflow.risk !== "read_only"
  const clientReady = clientResolution.status === "resolved" || clientResolution.status === "not_required"
  const canAutoExecute = primaryWorkflow.confidence >= 0.72
    && clientReady
    && primaryWorkflow.unavailableActions.length === 0
    && !requiresConfirmation
  return {
    request,
    primaryWorkflow,
    alternatives,
    clientResolution,
    inferredParameters,
    missingInformation,
    clarificationQuestions,
    executionPolicy: {
      mustDryRunFirst,
      requiresConfirmation,
      canAutoExecute,
      reason: requiresConfirmation
        ? "该工作流包含删除或其他不可逆操作，必须人工确认。"
        : primaryWorkflow.unavailableActions.length > 0
          ? "当前 Agent Token 缺少部分必需动作权限。"
          : !clientReady
            ? "需先确认客户上下文。"
            : primaryWorkflow.confidence < 0.72
              ? "需求存在多种解释，需先补充一个关键信息。"
              : "可先进行 dry-run 检查，再按计划执行。",
    },
  }
}

function workflow(input: Omit<AgentWorkflowDefinition, "requiresClient"> & { requiresClient?: boolean }): AgentWorkflowDefinition {
  return { ...input, requiresClient: input.requiresClient !== false }
}

function workflowScore(workflowDefinition: AgentWorkflowDefinition, request: string): number {
  let score = 0
  for (const rule of workflowDefinition.rules) {
    if (rule.pattern.test(request)) score += rule.weight
  }
  for (const rule of workflowDefinition.negativeRules || []) {
    if (rule.test(request)) score -= 10
  }
  return Math.max(0, score)
}

function workflowMatch(
  definition: AgentWorkflowDefinition,
  score: number,
  unavailableActions: AgentActionName[],
): AgentWorkflowMatch {
  const { rules, negativeRules, ...publicDefinition } = definition
  void rules
  void negativeRules
  return {
    ...publicDefinition,
    score,
    confidence: score <= 0 ? 0.35 : Number(Math.min(0.99, 0.52 + score / 50).toFixed(2)),
    unavailableActions,
  }
}

function resolveClient(input: {
  request: string
  clientHint?: string
  clients: AgentPlannerClient[]
  required: boolean
}): AgentClientResolution {
  if (!input.required) return { status: "not_required", reason: "该需求不依赖客户上下文。", candidates: [] }
  const clients = input.clients.slice(0, 500)
  const haystack = normalizeText(`${input.request} ${input.clientHint || ""}`)
  const candidates = clients.map(client => ({
    client,
    score: clientTerms(client).reduce((best, term) => {
      const normalized = normalizeText(term)
      if (normalized.length < 2 || !haystack.includes(normalized)) return best
      return Math.max(best, normalized.length)
    }, 0),
  })).filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.client.name.localeCompare(right.client.name, "zh-CN"))
  const publicCandidates = (candidates.length > 0 ? candidates : clients.map(client => ({ client, score: 0 })))
    .slice(0, 8)
    .map(({ client }) => ({ id: client.id, name: client.name, ourBrand: client.ourBrand, teamId: client.teamId }))

  if (candidates.length === 1 || (candidates.length > 1 && candidates[0].score > candidates[1].score)) {
    const selected = candidates[0].client
    return {
      status: "resolved",
      clientId: selected.id,
      clientName: selected.name,
      teamId: selected.teamId,
      subjectType: selected.subjectType,
      reason: "已通过客户名、品牌/人物名或别名匹配。",
      candidates: publicCandidates,
    }
  }
  if (candidates.length > 1) {
    return { status: "needs_clarification", reason: "需求中匹配到多个客户。", candidates: publicCandidates }
  }
  if (clients.length === 1 && !input.clientHint) {
    const selected = clients[0]
    return {
      status: "resolved",
      clientId: selected.id,
      clientName: selected.name,
      teamId: selected.teamId,
      subjectType: selected.subjectType,
      reason: "当前 Token 仅授权一个客户，已自动使用。",
      candidates: publicCandidates,
    }
  }
  if (input.clientHint) return { status: "not_found", reason: "客户提示未匹配到已授权客户。", candidates: publicCandidates }
  return { status: "needs_clarification", reason: "需求中没有唯一的客户指向。", candidates: publicCandidates }
}

function clientTerms(client: AgentPlannerClient): string[] {
  return Array.from(new Set([
    client.name,
    client.ourBrand || "",
    ...(client.aliases || []),
  ].map(value => String(value || "").trim()).filter(Boolean)))
}

function normalizeText(value: string): string {
  return String(value || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")
}

function inferParameters(request: string, client: AgentClientResolution): Record<string, unknown> {
  const requestedCount = request.match(/(?:生成|写|检测|做)?\s*(\d{1,4})\s*(?:个问题|条疑问句|篇文章|篇)/)?.[1]
  const intervalDays = request.match(/(?:隔|每)\s*([1-7])\s*天/)?.[1]
  const reportPeriod = /月报|月反馈|一个月/.test(request)
    ? "monthly"
    : /周报|周反馈|一周|7\s*天/.test(request)
      ? "weekly"
      : undefined
  return {
    ...(client.status === "resolved" ? {
      clientId: client.clientId,
      clientName: client.clientName,
      teamId: client.teamId,
      subjectType: client.subjectType,
    } : {}),
    ...(requestedCount ? { requestedCount: Number(requestedCount) } : {}),
    ...(intervalDays ? { intervalDays: Number(intervalDays) } : {}),
    ...(reportPeriod ? { reportPeriod } : {}),
    ...(request.includes("今天") || request.includes("当日") ? { date: "today" } : {}),
    requiresLiveWeb: /联网|搜索|信源|核验/.test(request),
  }
}

function parameterAppearsAvailable(label: string, request: string, inferred: Record<string, unknown>): boolean {
  if (label.includes("数量")) return typeof inferred.requestedCount === "number"
  if (label.includes("日期")) return Boolean(inferred.date || inferred.reportPeriod || /\d{4}-\d{2}-\d{2}/.test(request))
  if (label.includes("周报或月报")) return Boolean(inferred.reportPeriod)
  if (label.includes("检测间隔")) return typeof inferred.intervalDays === "number" || /每天/.test(request)
  if (label.includes("网站地址")) return /https?:\/\//i.test(request)
  return false
}
