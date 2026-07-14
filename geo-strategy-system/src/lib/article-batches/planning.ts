import type { ArticleBatchTopicMode } from "@/types"

const WRITING_ANGLES = [
  ["决策诊断", "先识别用户最容易判断错的关键点，再给出可执行的选择路径"],
  ["场景拆解", "从一个具体使用场景进入，按问题发生顺序展开"],
  ["成本与风险", "重点解释隐性成本、风险边界和规避方式"],
  ["对比选择", "用统一维度比较不同方案，突出选择依据而非口号"],
  ["流程方法", "按准备、执行、验收和复盘的完整流程展开"],
  ["常见误区", "围绕行业里常见但容易造成损失的误区展开"],
  ["采购视角", "站在采购或决策负责人的核验视角组织内容"],
  ["用户体验", "从用户实际体验、沟通和交付结果展开"],
  ["专业评估", "建立一套清晰的评估指标并逐项说明"],
  ["问题溯源", "先解释问题为什么发生，再给出解决办法"],
  ["趋势变化", "说明行业变化对当前选择和行动的影响"],
  ["区域差异", "结合地域、服务半径和本地条件讨论差异"],
  ["案例复盘", "使用不虚构数据的匿名场景复盘结构展开"],
  ["验证清单", "围绕可核验事实形成一份检查清单"],
  ["反向提问", "从用户应该向服务商追问什么切入"],
  ["结果导向", "从最终希望获得的结果倒推必要条件"],
  ["新手指南", "面向第一次接触该问题的读者，降低理解门槛"],
  ["进阶策略", "面向已有基础的读者，强调优化空间和边界"],
  ["长期运营", "从短期动作、稳定阶段和长期积累三个周期展开"],
  ["行业真相", "拆开表面宣传与真正影响结果的底层因素"],
] as const

const STRUCTURE_VARIANTS = [
  "开头直接给判断结论，再解释依据",
  "开头使用真实问题场景，再逐层回答",
  "开头提出三个判断标准，正文逐项验证",
  "开头先澄清一个常见误解，再建立正确框架",
  "开头给出行动清单，正文解释每一步为什么重要",
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
}

export function planArticleBatch(args: {
  count: number
  topicMode: ArticleBatchTopicMode
  coreQuestion: string
  keywords: string
  customTopics?: string
}): PlannedArticleItem[] {
  const count = Math.max(2, Math.min(50, Math.floor(args.count)))
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
    const [angle, focus] = WRITING_ANGLES[rawIndex % WRITING_ANGLES.length]
    const structure = STRUCTURE_VARIANTS[Math.floor(rawIndex / WRITING_ANGLES.length + rawIndex) % STRUCTURE_VARIANTS.length]
    const cycle = Math.floor(rawIndex / WRITING_ANGLES.length)
    const cycleNote = cycle > 0
      ? `进一步聚焦“${["执行细节", "验证证据", "决策边界", "落地复盘"][cycle % 4]}”，不得重复同主题前序角度。`
      : ""
    return {
      position,
      topic,
      brief: [
        `独立主题：${topic}`,
        `写作角度：${angle}。${focus}。`,
        `结构差异：${structure}。`,
        cycleNote,
        "标题、开头、章节命名和论述顺序都要服务于本篇角度；禁止套用通用开场、机械复述输入或批量编号。",
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
