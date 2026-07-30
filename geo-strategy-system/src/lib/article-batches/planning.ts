import type { ArticleBatchQuestionTask, ArticleBatchTopicMode } from "@/types"

const SAFE_WRITING_FOCUSES = [
  ["决策标准", "重点解释用户应该依据哪些可核验条件作出判断"],
  ["适用场景", "重点说明不同需求和使用场景下的适配边界"],
  ["验证方法", "重点提供可以实际核验的步骤、材料和判断依据"],
  ["风险边界", "重点说明容易误判的风险、限制条件和规避方式"],
  ["执行路径", "重点梳理从准备、执行到验收的可操作路径"],
] as const

const OPENING_VARIANTS = [
  "开头先直接回答核心问题，再解释依据",
  "开头从典型使用场景切入，但不得虚构真实案例",
  "开头先给出判断标准，再逐项说明",
  "开头先澄清一个常见误解，再回答问题",
  "开头先给出行动方向，再解释为什么",
] as const

function uniqueLines(value: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of String(value || "").split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*\d.)、\s]+/, "")
    const key = line.replace(/\s+/g, "").toLocaleLowerCase("zh-CN")
    if (!line || seen.has(key)) continue
    seen.add(key)
    result.push(line.slice(0, 500))
  }
  return result
}

export interface PlannedArticleItem {
  position: number
  topic: string
  brief: string
  questionId?: string
  materialId?: string
  questionSource?: ArticleBatchQuestionTask["questionSource"]
  intent?: string
  category?: string
  keyword?: string
  decisionDimension?: string
  contentAngle?: string
  geoOptimizationText?: string
  matchedAdvantage?: string
  subIntent?: ArticleBatchQuestionTask["subIntent"]
  queryStyle?: ArticleBatchQuestionTask["queryStyle"]
  methodologyCandidates?: ArticleBatchQuestionTask["methodologyCandidates"]
  platformCandidates?: ArticleBatchQuestionTask["platformCandidates"]
  targetPlatform?: ArticleBatchQuestionTask["targetPlatform"]
  articleFormat?: ArticleBatchQuestionTask["articleFormat"]
  brandLayout?: ArticleBatchQuestionTask["brandLayout"]
  titleStrategy?: ArticleBatchQuestionTask["titleStrategy"]
  knowledgeAssetIds?: ArticleBatchQuestionTask["knowledgeAssetIds"]
  methodologyVersion?: ArticleBatchQuestionTask["methodologyVersion"]
  promptKey?: ArticleBatchQuestionTask["promptKey"]
  promptTitle?: string
  routeConfidence?: number
  routeReason?: string
  missingEvidence?: string[]
}

function clean(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max)
}

function normalizeQuestionTasks(value: ArticleBatchQuestionTask[] | undefined): ArticleBatchQuestionTask[] {
  if (!Array.isArray(value)) return []
  return value
    .map(task => ({
      questionId: clean(task.questionId, 200) || undefined,
      materialId: clean(task.materialId, 200) || undefined,
      questionSource: task.questionSource,
      question: clean(task.question, 500),
      intent: clean(task.intent, 300) || undefined,
      category: clean(task.category, 120) || undefined,
      keyword: clean(task.keyword, 200) || undefined,
      decisionDimension: clean(task.decisionDimension, 200) || undefined,
      contentAngle: clean(task.contentAngle, 500) || undefined,
      geoOptimizationText: clean(task.geoOptimizationText, 2_000) || undefined,
      matchedAdvantage: clean(task.matchedAdvantage, 3_000) || undefined,
      subIntent: clean(task.subIntent, 300) || undefined,
      queryStyle: task.queryStyle,
      methodologyCandidates: task.methodologyCandidates,
      platformCandidates: task.platformCandidates,
      targetPlatform: task.targetPlatform,
      articleFormat: task.articleFormat,
      brandLayout: task.brandLayout,
      titleStrategy: task.titleStrategy,
      knowledgeAssetIds: task.knowledgeAssetIds,
      methodologyVersion: clean(task.methodologyVersion, 120) || undefined,
      promptKey: task.promptKey,
      promptTitle: clean(task.promptTitle, 160) || undefined,
      routeConfidence: Number.isFinite(task.routeConfidence)
        ? Math.max(0, Math.min(1, Number(task.routeConfidence)))
        : undefined,
      routeReason: clean(task.routeReason, 500) || undefined,
      missingEvidence: Array.isArray(task.missingEvidence)
        ? task.missingEvidence.map(item => clean(item, 300)).filter(Boolean).slice(0, 12)
        : undefined,
    }))
    .filter(task => Boolean(task.question))
}

function plannedQuestionTask(task: ArticleBatchQuestionTask, position: number): PlannedArticleItem {
  return {
    position,
    topic: task.question,
    brief: [
      `独立主题：${task.question}`,
      task.intent ? `用户意图：${task.intent}` : "",
      task.category ? `问题类型：${task.category}` : "",
      task.decisionDimension ? `决策维度：${task.decisionDimension}` : "",
      task.contentAngle ? `内容切入：${task.contentAngle}` : "",
      task.geoOptimizationText ? `GEO 收录要点：${task.geoOptimizationText}` : "",
      task.matchedAdvantage ? `本篇唯一匹配优势：${task.matchedAdvantage}` : "本篇未匹配到优势，不得挪用其他问题的优势。",
      "严格执行本篇分配的文章模板；不得读取、引用或假设存在其他批次文章。",
    ].filter(Boolean).join("\n"),
    questionId: task.questionId,
    materialId: task.materialId,
    questionSource: task.questionSource,
    intent: task.intent,
    category: task.category,
    keyword: task.keyword,
    decisionDimension: task.decisionDimension,
    contentAngle: task.contentAngle,
    geoOptimizationText: task.geoOptimizationText,
    matchedAdvantage: task.matchedAdvantage,
    subIntent: task.subIntent,
    queryStyle: task.queryStyle,
    methodologyCandidates: task.methodologyCandidates,
    platformCandidates: task.platformCandidates,
    targetPlatform: task.targetPlatform,
    articleFormat: task.articleFormat,
    brandLayout: task.brandLayout,
    titleStrategy: task.titleStrategy,
    knowledgeAssetIds: task.knowledgeAssetIds,
    methodologyVersion: task.methodologyVersion,
    promptKey: task.promptKey,
    promptTitle: task.promptTitle,
    routeConfidence: task.routeConfidence,
    routeReason: task.routeReason,
    missingEvidence: task.missingEvidence,
  }
}

export function planArticleBatch(args: {
  count: number
  topicMode: ArticleBatchTopicMode
  coreQuestion: string
  keywords: string
  customTopics?: string
  questionTasks?: ArticleBatchQuestionTask[]
}): PlannedArticleItem[] {
  const count = Math.max(
    args.topicMode === "strategy" ? 1 : 2,
    Math.min(50, Math.floor(args.count)),
  )
  const questionTasks = normalizeQuestionTasks(args.questionTasks)
  if ((args.topicMode === "questions" || args.topicMode === "strategy") && questionTasks.length > 0) {
    if (questionTasks.length < count) {
      throw new Error(`当前只选择了 ${questionTasks.length} 个问题，请补足到 ${count} 个。`)
    }
    return questionTasks.slice(0, count).map((task, index) => plannedQuestionTask(task, index + 1))
  }
  if (args.topicMode === "strategy") {
    throw new Error("策略自动成文没有收到有效的疑问句任务")
  }

  const providedTopics = uniqueLines(args.customTopics || "")
  if (args.topicMode !== "auto" && providedTopics.length < count) {
    throw new Error(`当前只填写了 ${providedTopics.length} 个主题，请补足到 ${count} 个，确保每篇文章独立生成。`)
  }

  const automaticTopics = uniqueLines([args.coreQuestion, args.keywords].filter(Boolean).join("\n"))
  if (args.topicMode === "auto" && automaticTopics.length === 0) {
    throw new Error("请先填写核心搜索问题或内容主题")
  }
  const topics = args.topicMode === "auto" ? automaticTopics : providedTopics

  return Array.from({ length: count }, (_, rawIndex) => {
    const position = rawIndex + 1
    const topic = topics[rawIndex % topics.length]
    const [focusName, focus] = SAFE_WRITING_FOCUSES[rawIndex % SAFE_WRITING_FOCUSES.length]
    const opening = OPENING_VARIANTS[Math.floor(rawIndex / SAFE_WRITING_FOCUSES.length + rawIndex) % OPENING_VARIANTS.length]
    const cycle = Math.floor(rawIndex / SAFE_WRITING_FOCUSES.length)
    const cycleNote = cycle > 0
      ? `本轮进一步聚焦“${["执行细节", "验证证据", "决策边界", "适用条件"][cycle % 4]}”，但不得改变所选模板规定的章节和输出格式。`
      : ""
    return {
      position,
      topic,
      brief: [
        `独立主题：${topic}`,
        `差异化重点：${focusName}。${focus}。`,
        `开篇方式：${opening}。`,
        cycleNote,
        "严格保留所选模板要求的章节和结构；标题与开头应独立表达，禁止批量编号、虚构案例或挪用其他主题资料。",
      ].filter(Boolean).join("\n"),
    }
  })
}

function normalizedText(value: string): string {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#>*_`|\[\](){}\d\s，。！？、；：,.!?;:'"“”‘’（）【】《》-]+/g, "")
    .slice(0, 12_000)
}

function shingles(value: string, size: number): Set<string> {
  const result = new Set<string>()
  if (value.length <= size) {
    if (value) result.add(value)
    return result
  }
  for (let index = 0; index <= value.length - size; index += 2) {
    result.add(value.slice(index, index + size))
  }
  return result
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const value of left) if (right.has(value)) intersection += 1
  return intersection / (left.size + right.size - intersection)
}

export function articleSimilarity(left: string, right: string): number {
  return jaccard(shingles(normalizedText(left), 8), shingles(normalizedText(right), 8))
}

export function mostSimilarArticle(
  candidate: string,
  existing: Array<{ id: string; markdown: string }>,
): { id?: string; score: number } {
  let best: { id?: string; score: number } = { score: 0 }
  for (const article of existing) {
    const score = articleSimilarity(candidate, article.markdown)
    if (score > best.score) best = { id: article.id, score }
  }
  return best
}

export const ARTICLE_SIMILARITY_RETRY_THRESHOLD = 0.62
