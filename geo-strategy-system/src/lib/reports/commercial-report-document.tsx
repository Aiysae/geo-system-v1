import path from "path"
import React from "react"
import {
  Circle,
  Document,
  Font,
  Image,
  Link,
  Page,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer"
import type {
  CommercialReportInput,
  DifficultyDimensionResult,
  ModelKey,
  PenetrationItem,
  PenetrationSource,
} from "@/types"

const FONT_DIR = path.join(process.cwd(), "public", "fonts")
const LOGO_PATH = path.join(process.cwd(), "public", "logo.jpg")

Font.register({
  family: "NotoSansSC",
  fonts: [
    { src: path.join(FONT_DIR, "noto-sans-sc-regular.woff"), fontWeight: 400 },
    { src: path.join(FONT_DIR, "noto-sans-sc-bold.woff"), fontWeight: 700 },
  ],
})

Font.registerHyphenationCallback(word => {
  const characters = Array.from(word)
  if (characters.some(character => /[\u3400-\u9FFF\uF900-\uFAFF]/.test(character))) {
    return characters
  }
  if (characters.length > 36) {
    const parts: string[] = []
    for (let index = 0; index < characters.length; index += 12) {
      parts.push(characters.slice(index, index + 12).join(""))
    }
    return parts
  }
  return [word]
})

const COLORS = {
  ink: "#071B2B",
  blue: "#00A6FB",
  violet: "#6D5DFB",
  amber: "#F59E0B",
  green: "#12B981",
  paper: "#F4F8FB",
  line: "#D9E5EC",
  text: "#243746",
  muted: "#6B7F8E",
  white: "#FFFFFF",
  red: "#E24A5A",
  cyan: "#00B4D8",
  slate: "#7992A3",
}

const MODEL_LABELS: Record<ModelKey, string> = {
  doubao: "豆包",
  deepseek: "DeepSeek",
  qwen: "通义千问",
  kimi: "Kimi",
  ernie: "文心一言",
  hunyuan: "腾讯混元",
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 42,
    paddingBottom: 42,
    paddingHorizontal: 38,
    backgroundColor: COLORS.white,
    color: COLORS.text,
    fontFamily: "NotoSansSC",
    fontSize: 9,
  },
  cover: {
    padding: 48,
    backgroundColor: COLORS.ink,
    color: COLORS.white,
    fontFamily: "NotoSansSC",
  },
  coverLogoBox: {
    width: 58,
    height: 58,
    padding: 6,
    borderRadius: 8,
    backgroundColor: COLORS.white,
  },
  coverLogo: { width: 46, height: 46, objectFit: "contain" },
  coverSignal: {
    marginTop: 52,
    width: 86,
    height: 5,
    backgroundColor: COLORS.blue,
    borderRadius: 2,
  },
  coverTitle: { marginTop: 18, fontSize: 28, fontWeight: 700, lineHeight: 1.3 },
  coverSubtitle: { marginTop: 10, fontSize: 12, color: "#B9D6E7" },
  coverMeta: {
    marginTop: 36,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: "#21445B",
    gap: 8,
  },
  coverMetaRow: { flexDirection: "row" },
  coverMetaLabel: { width: 76, color: "#78B9D7", fontSize: 9 },
  coverMetaValue: { flex: 1, color: COLORS.white, fontSize: 10 },
  coverFooter: {
    position: "absolute",
    left: 48,
    right: 48,
    bottom: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    color: "#7896A7",
    fontSize: 8,
  },
  header: {
    position: "absolute",
    top: 18,
    left: 38,
    right: 38,
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    paddingBottom: 6,
    color: COLORS.muted,
    fontSize: 7,
  },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 38,
    right: 38,
    flexDirection: "row",
    justifyContent: "space-between",
    color: COLORS.muted,
    fontSize: 7,
  },
  chapterKicker: { fontSize: 8, fontWeight: 700, color: COLORS.blue },
  chapterTitle: { marginTop: 5, fontSize: 21, fontWeight: 700, lineHeight: 1.3, color: COLORS.ink },
  chapterIntro: { marginTop: 7, marginBottom: 16, color: COLORS.muted, fontSize: 9.5, lineHeight: 1.45 },
  section: { marginBottom: 18 },
  sectionTitle: {
    marginBottom: 8,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    color: COLORS.ink,
    fontSize: 11,
    fontWeight: 700,
  },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  metricCard: {
    width: "48%",
    minWidth: 0,
    flexGrow: 1,
    minHeight: 64,
    padding: 10,
    borderRadius: 6,
    backgroundColor: COLORS.paper,
    borderWidth: 1,
    borderColor: COLORS.line,
    overflow: "hidden",
  },
  metricLabel: { color: COLORS.muted, fontSize: 7.5 },
  metricValue: { marginTop: 5, maxWidth: "100%", color: COLORS.ink, fontSize: 18, fontWeight: 700, lineHeight: 1.2 },
  metricNote: { marginTop: 4, maxWidth: "100%", color: COLORS.muted, fontSize: 7, lineHeight: 1.4 },
  detailMetric: {
    marginBottom: 14,
    padding: 11,
    borderRadius: 6,
    backgroundColor: COLORS.paper,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  detailMetricValue: { marginTop: 5, color: COLORS.ink, fontSize: 10, fontWeight: 700, lineHeight: 1.45 },
  insightBox: {
    padding: 12,
    borderRadius: 6,
    backgroundColor: "#EAF7FF",
    borderLeftWidth: 4,
    borderLeftColor: COLORS.blue,
    marginBottom: 12,
  },
  insightTitle: { color: COLORS.ink, fontSize: 10, fontWeight: 700, marginBottom: 5 },
  insightText: { width: "100%", color: COLORS.text, fontSize: 9, lineHeight: 1.65 },
  signalStrip: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  signalItem: {
    width: "31.9%",
    padding: 8,
    borderRadius: 5,
    backgroundColor: COLORS.ink,
  },
  signalLabel: { color: "#B9D6E7", fontSize: 7 },
  signalValue: { marginTop: 3, color: COLORS.white, fontSize: 12, fontWeight: 700 },
  barRow: { marginBottom: 8 },
  barHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  barLabel: { color: COLORS.text, fontSize: 8 },
  barValue: { color: COLORS.ink, fontSize: 8, fontWeight: 700 },
  barTrack: { height: 7, borderRadius: 3, backgroundColor: "#E7EEF3", overflow: "hidden" },
  barFill: { height: 7, borderRadius: 3 },
  listItem: { flexDirection: "row", alignItems: "flex-start", marginBottom: 7 },
  listIndex: {
    width: 18,
    flexShrink: 0,
    height: 18,
    borderRadius: 4,
    backgroundColor: COLORS.ink,
    color: COLORS.white,
    textAlign: "center",
    paddingTop: 2.5,
    fontSize: 7,
    fontWeight: 700,
  },
  listText: {
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    marginLeft: 7,
    color: COLORS.text,
    fontSize: 8.2,
    lineHeight: 1.48,
  },
  sourceRow: {
    marginBottom: 7,
    paddingBottom: 7,
    borderBottomWidth: 1,
    borderBottomColor: "#EDF2F5",
  },
  sourceTitle: { maxWidth: "100%", color: COLORS.ink, fontSize: 8.5, fontWeight: 700 },
  sourceMeta: { maxWidth: "100%", marginTop: 2, color: COLORS.muted, fontSize: 7, lineHeight: 1.4 },
  sourceLink: { maxWidth: "100%", marginTop: 2, color: "#0077B6", fontSize: 7, lineHeight: 1.35, textDecoration: "none" },
  appendixItem: {
    marginBottom: 10,
    padding: 9,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  appendixMeta: { color: COLORS.blue, fontSize: 7.5, fontWeight: 700 },
  appendixQuestion: { marginTop: 4, color: COLORS.ink, fontSize: 8.5, fontWeight: 700 },
  appendixAnswer: { maxWidth: "100%", marginTop: 4, color: COLORS.text, fontSize: 7.5, lineHeight: 1.55 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  pill: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: COLORS.paper,
    color: COLORS.muted,
    fontSize: 6.5,
  },
  methodology: {
    padding: 12,
    backgroundColor: COLORS.paper,
    borderRadius: 6,
    color: COLORS.muted,
    fontSize: 7.5,
    lineHeight: 1.6,
  },
  penetrationHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginBottom: 18,
    padding: 14,
    borderRadius: 8,
    backgroundColor: COLORS.paper,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  ringBox: { position: "relative", width: 128, alignItems: "center", justifyContent: "center" },
  ringOverlay: {
    position: "absolute",
    top: 36,
    left: 0,
    width: 128,
    alignItems: "center",
  },
  ringValue: { color: COLORS.ink, fontSize: 20, fontWeight: 700 },
  ringLabel: { marginTop: 2, color: COLORS.muted, fontSize: 7 },
  heroMetrics: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  heroMetric: {
    width: "47.5%",
    minHeight: 50,
    padding: 8,
    borderRadius: 5,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  heroMetricLabel: { color: COLORS.muted, fontSize: 7 },
  heroMetricValue: { marginTop: 4, color: COLORS.ink, fontSize: 13, fontWeight: 700 },
  table: { borderWidth: 1, borderColor: COLORS.line, borderRadius: 5, overflow: "hidden" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.line, minHeight: 25 },
  tableLastRow: { borderBottomWidth: 0 },
  tableHeader: { backgroundColor: COLORS.ink },
  tableHeaderText: { color: COLORS.white, fontSize: 7, fontWeight: 700 },
  tableCell: { paddingHorizontal: 6, paddingVertical: 6, justifyContent: "center", minWidth: 0 },
  tableText: { color: COLORS.text, fontSize: 7.2, lineHeight: 1.35 },
  tableTextStrong: { color: COLORS.ink, fontSize: 7.2, fontWeight: 700, lineHeight: 1.35 },
  rankBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    paddingTop: 3,
    textAlign: "center",
    color: COLORS.white,
    fontSize: 6.5,
    fontWeight: 700,
  },
  tableNote: { marginTop: 6, color: COLORS.muted, fontSize: 6.8, lineHeight: 1.4 },
  continuationLabel: { marginBottom: 8, color: COLORS.muted, fontSize: 7.2 },
})

type FlattenedAnswer = {
  model: ModelKey
  item: PenetrationItem
}

type QuestionCoverageRow = {
  question: string
  total: number
  hits: number
  verified: number
  sourceCount: number
}

function metricValueStyle(value: string): { fontSize: number; lineHeight: number } {
  const length = Array.from(value).length
  if (length <= 10) return { fontSize: 18, lineHeight: 1.2 }
  if (length <= 20) return { fontSize: 13, lineHeight: 1.28 }
  if (length <= 38) return { fontSize: 10, lineHeight: 1.38 }
  return { fontSize: 8, lineHeight: 1.45 }
}

function concisePeriod(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (/暂无|尚未|未形成|0\s*(?:天|日)/.test(normalized)) return "尚未形成稳定提及周期"
  const match = normalized.match(/(?:约)?\s*\d+\s*(?:[-~至到]\s*\d+)?\s*(?:天|日|周|个月|月)/)
  if (match) return match[0].replace(/\s+/g, "")
  return normalized || "未提供周期判断"
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

function questionCoverageRows(answers: FlattenedAnswer[]): QuestionCoverageRow[] {
  const rows = new Map<string, QuestionCoverageRow>()
  for (const { item } of answers) {
    const question = item.question.trim() || "未命名问题"
    const row = rows.get(question) || { question, total: 0, hits: 0, verified: 0, sourceCount: 0 }
    row.total += 1
    row.hits += item.hitOur ? 1 : 0
    row.verified += item.webVerified ? 1 : 0
    row.sourceCount += item.searchSources?.length || 0
    rows.set(question, row)
  }
  return Array.from(rows.values())
}

function estimatedTextHeight(value: string, charactersPerLine: number, lineHeight: number, padding = 0): number {
  const length = Math.max(1, Array.from(value.replace(/\s+/g, " ").trim()).length)
  return Math.max(lineHeight, Math.ceil(length / charactersPerLine) * lineHeight) + padding
}

function paginateQuestionRows(rows: QuestionCoverageRow[]): QuestionCoverageRow[][] {
  const maxPageHeight = 540
  const maxRowsPerPage = 15
  const pages: QuestionCoverageRow[][] = []
  let page: QuestionCoverageRow[] = []
  let pageHeight = 0

  for (const row of rows) {
    const rowHeight = estimatedTextHeight(row.question, 38, 10, 13)
    if (page.length > 0 && (page.length >= maxRowsPerPage || pageHeight + rowHeight > maxPageHeight)) {
      pages.push(page)
      page = []
      pageHeight = 0
    }
    page.push(row)
    pageHeight += rowHeight
  }
  if (page.length > 0) pages.push(page)

  if (pages.length > 1) {
    const previous = pages[pages.length - 2]
    const last = pages[pages.length - 1]
    let lastHeight = last.reduce((sum, row) => sum + estimatedTextHeight(row.question, 38, 10, 13), 0)
    while (last.length < 6 && previous.length > last.length + 1) {
      const candidate = previous[previous.length - 1]
      const candidateHeight = estimatedTextHeight(candidate.question, 38, 10, 13)
      if (lastHeight + candidateHeight > maxPageHeight) break
      previous.pop()
      last.unshift(candidate)
      lastHeight += candidateHeight
    }
  }

  return pages
}

function paginateListItems(items: string[]): string[][] {
  const maxPageHeight = 585
  const maxItemsPerPage = 12
  const pages: string[][] = []
  let page: string[] = []
  let pageHeight = 0

  for (const item of items) {
    const itemHeight = estimatedTextHeight(item, 54, 12.2, 9)
    if (page.length > 0 && (page.length >= maxItemsPerPage || pageHeight + itemHeight > maxPageHeight)) {
      pages.push(page)
      page = []
      pageHeight = 0
    }
    page.push(item)
    pageHeight += itemHeight
  }
  if (page.length > 0) pages.push(page)
  return pages
}

function percent(value: number): string {
  return `${(Math.max(0, value) * 100).toFixed(value > 0 && value < 0.01 ? 1 : 0)}%`
}

function formatDate(value: string | undefined): string {
  if (!value) return "未记录"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN", { hour12: false })
}

function formatDateToMinute(value: string | undefined): string {
  return formatDate(value).replace(/:\d{2}$/, "")
}

function reportId(input: CommercialReportInput): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)
  return `STGEO-${input.client.id.slice(0, 8).toUpperCase()}-${stamp}`
}

function flattenAnswers(input: CommercialReportInput): FlattenedAnswer[] {
  const result: FlattenedAnswer[] = []
  for (const [model, items] of Object.entries(input.penetration?.byModel || {}) as Array<[
    ModelKey,
    PenetrationItem[] | undefined,
  ]>) {
    for (const item of items || []) result.push({ model, item })
  }
  return result
}

function uniqueSources(answers: FlattenedAnswer[]): PenetrationSource[] {
  const seen = new Set<string>()
  const sources: PenetrationSource[] = []
  for (const { item } of answers) {
    for (const source of item.searchSources || []) {
      try {
        const url = new URL(source.url)
        if (!/https?:/.test(url.protocol) || seen.has(url.href)) continue
        seen.add(url.href)
        sources.push({ ...source, url: url.href })
      } catch {
        continue
      }
    }
  }
  return sources
}

function sourceDomainCounts(sources: PenetrationSource[]): Array<{ domain: string; count: number }> {
  const counts = new Map<string, number>()
  for (const source of sources) {
    const domain = source.domain || "未知域名"
    counts.set(domain, (counts.get(domain) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
}

function verifiedRate(answers: FlattenedAnswer[]): number {
  if (answers.length === 0) return 0
  return answers.filter(({ item }) => item.webVerified === true).length / answers.length
}

function distinctQuestions(answers: FlattenedAnswer[]): number {
  return new Set(answers.map(({ item }) => item.question.trim()).filter(Boolean)).size
}

function executiveSummary(input: CommercialReportInput, answers: FlattenedAnswer[]): string {
  const sections: string[] = []
  const penetration = input.penetration?.aggregated
  if (penetration) {
    const rank = penetration.ourRanking ? `行业声量位列第 ${penetration.ourRanking}` : "当前未进入行业品牌声量排名"
    sections.push(
      `本次多模型检测覆盖 ${distinctQuestions(answers)} 条疑问句、${penetration.perModelRate.length} 个模型和 ${penetration.totalSlots} 个检测槽位；我方品牌渗透率为 ${percent(penetration.penetrationRate)}，${rank}。`,
    )
  }
  if (input.difficulty) {
    sections.push(
      `难度测评总分为 ${input.difficulty.result.totalScore} 分，等级为“${input.difficulty.result.level}”，稳定提及周期判断为 ${concisePeriod(input.difficulty.result.stableMentionPeriod)}。`,
    )
  }
  if (answers.length > 0) {
    sections.push(`联网可验证率为 ${percent(verifiedRate(answers))}，本报告仅基于系统已保存的检测结果与可审计信源生成。`)
  }
  return sections.join("") || "当前客户尚未生成可用于报告的检测或难度测评数据。"
}

function actionItems(input: CommercialReportInput): string[] {
  const actions: string[] = []
  const missed = input.penetration?.aggregated.missedQuestions || []
  for (const question of missed.slice(0, 3)) {
    actions.push(`围绕“${question}”补齐可被模型引用的权威问答、案例与第三方信源。`)
  }
  for (const suggestion of input.difficulty?.result.suggestions || []) {
    if (suggestion.trim()) actions.push(suggestion.trim())
    if (actions.length >= 8) break
  }
  const topCompetitor = input.penetration?.aggregated.topCompetitors?.[0]
  if (topCompetitor && actions.length < 8) {
    actions.push(`针对高频竞品“${topCompetitor}”建立差异化证据页，明确可验证的产品、案例和服务边界。`)
  }
  if (actions.length === 0) actions.push("完成更多疑问句检测和难度测评后，再形成分阶段 GEO 行动路线。")
  return actions.slice(0, 8)
}

function HeaderFooter({ input }: { input: CommercialReportInput }) {
  return (
    <>
      <View style={styles.header} fixed>
        <Text>势途 GEO 商业洞察报告</Text>
        <Text>{input.client.name} · {input.client.industry || "未填写行业"}</Text>
      </View>
      <View style={styles.footer} fixed>
        <Text>杭州势途数字科技有限公司 · 内部与客户授权使用</Text>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </>
  )
}

function ChapterTitle({ kicker, title, intro }: { kicker: string; title: string; intro: string }) {
  return (
    <View>
      <Text style={styles.chapterKicker}>{kicker}</Text>
      <Text style={styles.chapterTitle}>{title}</Text>
      <Text style={styles.chapterIntro}>{intro}</Text>
    </View>
  )
}

function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={styles.metricCard} wrap={false}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, metricValueStyle(value)]}>{value}</Text>
      {note ? <Text style={styles.metricNote}>{note}</Text> : null}
    </View>
  )
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  const fitted = metricValueStyle(value)
  return (
    <View style={styles.detailMetric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.detailMetricValue, { fontSize: Math.min(11, fitted.fontSize), lineHeight: Math.max(1.35, fitted.lineHeight) }]} orphans={2} widows={2}>{value}</Text>
    </View>
  )
}

function DonutChart({ value, display, label, color = COLORS.blue }: {
  value: number
  display: string
  label: string
  color?: string
}) {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const progress = circumference * normalized
  const partialDash = normalized > 0 && normalized < 1
  return (
    <View style={styles.ringBox} wrap={false}>
      <Svg width={112} height={112} viewBox="0 0 112 112">
        <Circle cx={56} cy={56} r={radius} fill="none" stroke="#DDE8EF" strokeWidth={12} />
        {normalized > 0 ? (
          <Circle
            cx={56}
            cy={56}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={12}
            strokeLinecap="round"
            strokeDasharray={partialDash ? `${progress} ${circumference - progress}` : undefined}
            transform="rotate(-90 56 56)"
          />
        ) : null}
      </Svg>
      <View style={styles.ringOverlay}>
        <Text style={styles.ringValue}>{display}</Text>
        <Text style={styles.ringLabel}>{label}</Text>
      </View>
    </View>
  )
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroMetric} wrap={false}>
      <Text style={styles.heroMetricLabel}>{label}</Text>
      <Text style={[styles.heroMetricValue, metricValueStyle(value)]}>{value}</Text>
    </View>
  )
}

function TableCell({ width, children, header = false, strong = false }: {
  width: string
  children: React.ReactNode
  header?: boolean
  strong?: boolean
}) {
  return (
    <View style={[styles.tableCell, { width }]}>
      <Text style={header ? styles.tableHeaderText : strong ? styles.tableTextStrong : styles.tableText}>
        {children}
      </Text>
    </View>
  )
}

function HorizontalBar({ label, value, display, color }: { label: string; value: number; display: string; color: string }) {
  const width = `${Math.max(2, Math.min(100, value * 100))}%`
  return (
    <View style={styles.barRow} wrap={false}>
      <View style={styles.barHeader}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barValue}>{display}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width, backgroundColor: color }]} />
      </View>
    </View>
  )
}

function NumberedList({ items, startIndex = 0 }: { items: string[]; startIndex?: number }) {
  return (
    <View>
      {items.map((item, index) => (
        <View key={`${index}-${item}`} style={styles.listItem} wrap={false}>
          <Text style={styles.listIndex}>{startIndex + index + 1}</Text>
          <Text style={styles.listText} orphans={2} widows={2}>{item}</Text>
        </View>
      ))}
    </View>
  )
}

function CoverPage({ input }: { input: CommercialReportInput }) {
  const kindLabel = input.kind === "combined"
    ? "GEO 综合商业洞察报告"
    : input.kind === "penetration"
      ? "GEO 渗透率情报报告"
      : "GEO 难度测评报告"
  return (
    <Page size="A4" style={styles.cover}>
      <View style={styles.coverLogoBox}>
        {/* react-pdf Image is not a DOM img and has no alt prop. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image src={LOGO_PATH} style={styles.coverLogo} />
      </View>
      <View style={styles.coverSignal} />
      <Text style={styles.coverTitle}>{kindLabel}</Text>
      <Text style={styles.coverSubtitle}>AI 心智占位 · 品牌可见度 · 竞争难度 · 行动路径</Text>
      <View style={styles.coverMeta}>
        <View style={styles.coverMetaRow}><Text style={styles.coverMetaLabel}>客户</Text><Text style={styles.coverMetaValue}>{input.client.name}</Text></View>
        <View style={styles.coverMetaRow}><Text style={styles.coverMetaLabel}>目标品牌</Text><Text style={styles.coverMetaValue}>{input.client.ourBrand || "未填写"}</Text></View>
        <View style={styles.coverMetaRow}><Text style={styles.coverMetaLabel}>行业</Text><Text style={styles.coverMetaValue}>{input.client.industry || "未填写"}</Text></View>
        <View style={styles.coverMetaRow}><Text style={styles.coverMetaLabel}>报告版本</Text><Text style={styles.coverMetaValue}>{input.detail === "full" ? "审计附录版" : "精简决策版"}</Text></View>
        <View style={styles.coverMetaRow}><Text style={styles.coverMetaLabel}>生成时间</Text><Text style={styles.coverMetaValue}>{formatDate(new Date().toISOString())}</Text></View>
      </View>
      <View style={styles.coverFooter}>
        <Text>CONFIDENTIAL · 势途 GEO</Text>
        <Text>{reportId(input)}</Text>
      </View>
    </Page>
  )
}

function SummaryPage({ input, answers, sources }: { input: CommercialReportInput; answers: FlattenedAnswer[]; sources: PenetrationSource[] }) {
  const penetration = input.penetration?.aggregated
  const difficulty = input.difficulty?.result
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="EXECUTIVE VIEW" title="管理层摘要" intro="把复杂模型检测压缩为可决策的品牌心智信号。" />
      <View style={styles.metricsGrid}>
        <MetricCard label="品牌渗透率" value={penetration ? percent(penetration.penetrationRate) : "未检测"} note={penetration ? `${penetration.ourMentions}/${penetration.totalSlots} 个槽位命中` : undefined} />
        <MetricCard label="品牌声量排名" value={penetration?.ourRanking ? `第 ${penetration.ourRanking}` : "未上榜"} note={penetration ? `共识别 ${penetration.industryShare.length} 个品牌` : undefined} />
        <MetricCard label="联网可验证率" value={answers.length ? percent(verifiedRate(answers)) : "无数据"} note={`${sources.length} 条去重信源`} />
        <MetricCard label="GEO 难度" value={difficulty ? `${difficulty.totalScore} 分` : "未测评"} note={difficulty ? `${difficulty.level} · ${concisePeriod(difficulty.stableMentionPeriod)}` : undefined} />
      </View>
      <View style={styles.insightBox} wrap={false}>
        <Text style={styles.insightTitle}>核心结论</Text>
        <Text style={styles.insightText}>{executiveSummary(input, answers)}</Text>
      </View>
      {penetration?.perModelRate?.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AI 心智信号带</Text>
          <View style={styles.signalStrip}>
            {penetration.perModelRate.map(item => (
              <View key={item.model} style={styles.signalItem} wrap={false}>
                <Text style={styles.signalLabel}>{MODEL_LABELS[item.model]}</Text>
                <Text style={styles.signalValue}>{percent(item.rate)}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>优先行动</Text>
        <NumberedList items={actionItems(input).slice(0, 5)} />
      </View>
    </Page>
  )
}

function PenetrationPage({ input, answers }: { input: CommercialReportInput; answers: FlattenedAnswer[] }) {
  const penetration = input.penetration!
  const brands = penetration.aggregated.industryShare.slice(0, 10)
  const maxBrandRate = Math.max(0.01, ...brands.map(item => item.penetrationRate))
  const rankColors = [COLORS.amber, COLORS.violet, COLORS.blue]
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="VISIBILITY INTELLIGENCE" title="渗透率与竞品情报" intro={`覆盖 ${distinctQuestions(answers)} 条疑问句和 ${penetration.aggregated.perModelRate.length} 个模型，统计口径为模型回答中的品牌真实提及。`} />
      <View style={styles.penetrationHero} wrap={false}>
        <DonutChart
          value={penetration.aggregated.penetrationRate}
          display={percent(penetration.aggregated.penetrationRate)}
          label="品牌渗透率"
        />
        <View style={styles.heroMetrics}>
          <HeroMetric label="品牌命中" value={`${penetration.aggregated.ourMentions}/${penetration.aggregated.totalSlots}`} />
          <HeroMetric label="行业声量排名" value={penetration.aggregated.ourRanking ? `第 ${penetration.aggregated.ourRanking}` : "未上榜"} />
          <HeroMetric label="检测问题" value={`${distinctQuestions(answers)} 条`} />
          <HeroMetric label="识别品牌" value={`${penetration.aggregated.industryShare.length} 个`} />
        </View>
      </View>
      <View style={styles.section} wrap={false}>
        <Text style={styles.sectionTitle}>全品牌渗透率 Top {brands.length}</Text>
        {brands.map((item, index) => (
          <HorizontalBar
            key={item.brand}
            label={`${index + 1}. ${item.brand}`}
            value={item.penetrationRate / maxBrandRate}
            display={`${percent(item.penetrationRate)} · ${item.count} 次`}
            color={rankColors[index] || COLORS.slate}
          />
        ))}
      </View>
      <View style={styles.methodology}>
        <Text>统计说明：目标品牌全称及已配置别名在回答原文中通过字面校验后才计为命中。失败或空回答不会被包装成成功结果。</Text>
      </View>
    </Page>
  )
}

function PenetrationTablesPage({ input }: { input: CommercialReportInput }) {
  const penetration = input.penetration!
  const brands = penetration.aggregated.industryShare.slice(0, 10)
  const models = penetration.aggregated.perModelRate
  const rankColors = [COLORS.amber, COLORS.violet, COLORS.blue]
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="DATA TABLES" title="品牌与模型数据表" intro="把图表中的相对位置还原为可复核的次数、比例与模型覆盖口径。" />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>全品牌渗透率 Top {brands.length}</Text>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <TableCell width="10%" header>排名</TableCell>
            <TableCell width="44%" header>品牌</TableCell>
            <TableCell width="20%" header>提及次数</TableCell>
            <TableCell width="26%" header>渗透率</TableCell>
          </View>
          {brands.map((item, index) => (
            <View key={item.brand} style={[styles.tableRow, index === brands.length - 1 ? styles.tableLastRow : {}]} wrap={false}>
              <View style={[styles.tableCell, { width: "10%", alignItems: "center" }]}>
                <Text style={[styles.rankBadge, { backgroundColor: rankColors[index] || COLORS.slate }]}>{index + 1}</Text>
              </View>
              <TableCell width="44%" strong>{item.brand}</TableCell>
              <TableCell width="20%">{item.count} 次</TableCell>
              <TableCell width="26%" strong>{percent(item.penetrationRate)}</TableCell>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>各模型目标品牌命中率</Text>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <TableCell width="34%" header>模型</TableCell>
            <TableCell width="22%" header>命中</TableCell>
            <TableCell width="22%" header>回答数</TableCell>
            <TableCell width="22%" header>命中率</TableCell>
          </View>
          {models.map((item, index) => (
            <View key={item.model} style={[styles.tableRow, index === models.length - 1 ? styles.tableLastRow : {}]} wrap={false}>
              <TableCell width="34%" strong>{MODEL_LABELS[item.model]}</TableCell>
              <TableCell width="22%">{item.mentions}</TableCell>
              <TableCell width="22%">{item.total}</TableCell>
              <TableCell width="22%" strong>{percent(item.rate)}</TableCell>
            </View>
          ))}
        </View>
        <Text style={styles.tableNote}>说明：同一疑问句由多个模型分别回答，因此模型表中的回答数与“检测问题数”不是同一口径。</Text>
      </View>
    </Page>
  )
}

function QuestionCoveragePages({ input, answers }: { input: CommercialReportInput; answers: FlattenedAnswer[] }) {
  const rows = questionCoverageRows(answers)
  const limit = input.detail === "full" ? 80 : 20
  const pages = paginateQuestionRows(rows.slice(0, limit))
  return pages.map((pageRows, pageIndex) => (
    <Page key={`question-coverage-${pageIndex}`} size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle
        kicker="QUESTION COVERAGE"
        title={pageIndex === 0 ? "疑问句覆盖明细" : "疑问句覆盖明细（续）"}
        intro="逐题汇总目标品牌命中、联网可验证回答和信源数量，便于定位优先补强的问题。"
      />
      <Text style={styles.continuationLabel}>第 {pageIndex + 1} 组 · 共 {Math.min(rows.length, limit)} 条问题</Text>
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <TableCell width="58%" header>疑问句</TableCell>
          <TableCell width="14%" header>品牌命中</TableCell>
          <TableCell width="16%" header>联网验证</TableCell>
          <TableCell width="12%" header>信源</TableCell>
        </View>
        {pageRows.map((row, index) => (
          <View key={row.question} style={[styles.tableRow, index === pageRows.length - 1 ? styles.tableLastRow : {}]} wrap={false}>
            <TableCell width="58%" strong>{row.question}</TableCell>
            <TableCell width="14%">{row.hits}/{row.total}</TableCell>
            <TableCell width="16%">{row.verified}/{row.total}</TableCell>
            <TableCell width="12%">{row.sourceCount}</TableCell>
          </View>
        ))}
      </View>
      {pageIndex === pages.length - 1 && rows.length > limit ? (
        <Text style={styles.tableNote}>当前版本展示前 {limit} 条疑问句，其余问题保留在系统原始检测结果中。</Text>
      ) : null}
    </Page>
  ))
}

function PenetrationOpportunityPage({ input }: { input: CommercialReportInput }) {
  const penetration = input.penetration!
  const competitors = (penetration.aggregated.topCompetitors || []).slice(0, 8)
    .map(item => `${item} 在本轮回答中形成较高频的模型心智占位。`)
  const missed = (penetration.aggregated.missedQuestions || []).slice(0, 14)
  if (competitors.length === 0 && missed.length === 0) return null
  return (
    <Page size="A4" style={styles.page} wrap>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="GAP ANALYSIS" title="竞争与问题缺口" intro="把品牌声量差距转化为可执行的竞品对照与疑问句补强清单。" />
      {competitors.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>主要竞品</Text>
          <NumberedList items={competitors} />
        </View>
      ) : null}
      {missed.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>目标品牌未覆盖疑问句</Text>
          <NumberedList items={missed} />
        </View>
      ) : null}
    </Page>
  )
}

function SourcesPage({ input, answers, sources }: { input: CommercialReportInput; answers: FlattenedAnswer[]; sources: PenetrationSource[] }) {
  const domains = sourceDomainCounts(sources)
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="EVIDENCE AUDIT" title="联网信源与可审计性" intro="先展示联网验证覆盖与来源结构，再在后续索引页列出可点击的具体网址。" />
      <View style={styles.metricsGrid}>
        <MetricCard label="联网可验证回答" value={`${answers.filter(({ item }) => item.webVerified).length}/${answers.length}`} />
        <MetricCard label="去重信源" value={`${sources.length}`} />
        <MetricCard label="来源域名" value={`${domains.length}`} />
        <MetricCard label="仅原始问题请求" value={`${answers.filter(({ item }) => item.promptPurity === "raw_question_only").length}/${answers.length}`} />
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>高频来源域名</Text>
        {domains.slice(0, 12).map((item, index) => (
          <HorizontalBar key={item.domain} label={item.domain} value={item.count / Math.max(1, domains[0]?.count || 1)} display={`${item.count} 次`} color={index < 3 ? [COLORS.amber, COLORS.violet, COLORS.blue][index] : COLORS.slate} />
        ))}
      </View>
      <View style={styles.methodology}>
        <Text>信源说明：仅保留合法的 HTTP/HTTPS 地址，并按完整网址去重。域名频次用于观察模型引用来源是否过度集中。</Text>
      </View>
    </Page>
  )
}

function SourceIndexPages({ input, sources }: { input: CommercialReportInput; sources: PenetrationSource[] }) {
  const sourceLimit = input.detail === "full" ? 80 : 24
  const visible = sources.slice(0, sourceLimit)
  const pages = chunk(visible, 12)
  return pages.map((pageSources, pageIndex) => (
    <Page key={`source-index-${pageIndex}`} size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle
        kicker="SOURCE INDEX"
        title={pageIndex === 0 ? "可点击信源索引" : "可点击信源索引（续）"}
        intro="每条来源均保留网页标题、域名、触发查询与具体网址，可直接点击复核。"
      />
      <Text style={styles.continuationLabel}>第 {pageIndex + 1} 组 · 共展示 {visible.length} 条去重信源</Text>
      {pageSources.map((source, index) => {
        const absoluteIndex = pageIndex * 12 + index
        return (
          <View key={`${source.url}-${absoluteIndex}`} style={styles.sourceRow} wrap={false}>
            <Text style={styles.sourceTitle}>{absoluteIndex + 1}. {source.title || source.domain || "未命名来源"}</Text>
            <Text style={styles.sourceMeta}>{source.domain} · 查询：{source.query || "未记录"}</Text>
            <Link src={source.url} style={styles.sourceLink}>{source.url.length > 100 ? `${source.url.slice(0, 97)}...` : source.url}</Link>
          </View>
        )
      })}
      {pageIndex === pages.length - 1 && sources.length > sourceLimit ? (
        <Text style={styles.tableNote}>当前版本展示前 {sourceLimit} 条信源，其余信源保留在系统原始回答审计中。</Text>
      ) : null}
    </Page>
  ))
}

function DifficultyPage({ input }: { input: CommercialReportInput }) {
  const entry = input.difficulty!
  const result = entry.result
  const dimensions = Object.values(result.dimensions) as DifficultyDimensionResult[]
  const provider = entry.source || result.providerLabel || "服务端模型"
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="DIFFICULTY ASSESSMENT" title="GEO 难度测评" intro={`${entry.city || "全国"} · ${entry.industry} · ${entry.mode === "brand" ? entry.targetBrand || "品牌评估" : "行业评估"}`} />
      <View style={styles.penetrationHero} wrap={false}>
        <DonutChart value={result.totalScore / 100} display={`${result.totalScore}`} label="难度总分 / 100" color={COLORS.violet} />
        <View style={styles.heroMetrics}>
          <HeroMetric label="难度等级" value={result.level} />
          <HeroMetric label="报告来源" value={provider} />
          <HeroMetric label="评估模式" value={entry.mode === "brand" ? "品牌评估" : "行业评估"} />
          <HeroMetric label="报告时间" value={formatDateToMinute(result.generatedAt)} />
        </View>
      </View>
      <DetailMetric label="稳定提及周期" value={concisePeriod(result.stableMentionPeriod)} />
      <View style={styles.insightBox}>
        <Text style={styles.insightTitle}>测评结论</Text>
        <Text style={styles.insightText} orphans={2} widows={2}>{result.summary}</Text>
      </View>
      <View style={styles.section} wrap={false}>
        <Text style={styles.sectionTitle}>六维评分</Text>
        {dimensions.map((item, index) => (
          <HorizontalBar key={`${item.name}-${index}`} label={`${item.name} · ${item.level}`} value={item.score / Math.max(1, item.max)} display={`${item.score}/${item.max}`} color={[COLORS.blue, COLORS.violet, COLORS.green, COLORS.amber, COLORS.cyan, COLORS.slate][index % 6]} />
        ))}
      </View>
    </Page>
  )
}

function DifficultyDetailsPage({ input }: { input: CommercialReportInput }) {
  const dimensions = Object.values(input.difficulty!.result.dimensions) as DifficultyDimensionResult[]
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="SCORE EXPLANATION" title="六维评分详解" intro="完整保留各维度分值、等级与判断依据，避免图表只显示分数而缺少解释。" />
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <TableCell width="22%" header>维度</TableCell>
          <TableCell width="11%" header>分数</TableCell>
          <TableCell width="12%" header>等级</TableCell>
          <TableCell width="55%" header>分析说明</TableCell>
        </View>
        {dimensions.map((item, index) => (
          <View key={`${item.name}-${index}`} style={[styles.tableRow, index === dimensions.length - 1 ? styles.tableLastRow : {}]} wrap={false}>
            <TableCell width="22%" strong>{item.name}</TableCell>
            <TableCell width="11%" strong>{item.score}/{item.max}</TableCell>
            <TableCell width="12%">{item.level}</TableCell>
            <TableCell width="55%">{item.analysis}</TableCell>
          </View>
        ))}
      </View>
    </Page>
  )
}

function DifficultyInsightsPages({ input }: { input: CommercialReportInput }) {
  const result = input.difficulty!.result
  const sections = [
    {
      key: "insights",
      kicker: "KEY INSIGHTS",
      title: "关键洞察",
      intro: "将测评中的主要阻力、资产缺口与可见度问题按优先级独立呈现。",
      items: result.insights,
    },
    {
      key: "suggestions",
      kicker: "STRATEGY ACTIONS",
      title: "策略建议",
      intro: "将洞察转化为内容、信源、品牌资产与持续监测的具体行动。",
      items: result.suggestions,
    },
  ]

  return sections.flatMap(section => {
    const pages = paginateListItems(section.items)
    let startIndex = 0
    return pages.map((items, pageIndex) => {
      const itemStart = startIndex
      startIndex += items.length
      return (
        <Page key={`${section.key}-${pageIndex}`} size="A4" style={styles.page}>
          <HeaderFooter input={input} />
          <ChapterTitle
            kicker={section.kicker}
            title={pageIndex === 0 ? section.title : `${section.title}（续）`}
            intro={section.intro}
          />
          <Text style={styles.continuationLabel}>第 {pageIndex + 1} 组 · 共 {section.items.length} 条</Text>
          <NumberedList items={items} startIndex={itemStart} />
        </Page>
      )
    })
  })
}

function ActionPage({ input }: { input: CommercialReportInput }) {
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="ACTION ROADMAP" title="行动路线与方法说明" intro="把报告结论转化为可执行的内容、信源和品牌资产建设任务。" />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>建议优先级</Text>
        <NumberedList items={actionItems(input)} />
      </View>
      <View style={styles.methodology}>
        <Text>方法说明</Text>
        <Text style={{ marginTop: 5 }}>1. 渗透率来自所选模型对真实疑问句的独立回答，模型回答与信源按原始结果保存。</Text>
        <Text>2. 品牌识别在回答生成后完成，不把目标品牌和优势信息注入被测问题。</Text>
        <Text>3. 难度测评来自系统保存的五步评估结果，报告不额外调用 AI，也不补写未提供的事实。</Text>
        <Text>4. 本报告用于 GEO 策略与内容决策，不构成法律、财务或绝对排名承诺。</Text>
      </View>
    </Page>
  )
}

function ProcessEvidencePage({ input }: { input: CommercialReportInput }) {
  const stages = Object.values(input.difficulty?.result.process || {})
  if (stages.length === 0) return null
  return (
    <Page size="A4" style={styles.page} wrap>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="PROCESS EVIDENCE" title="测评过程证据" intro="按阶段保留调研、对比、评分、复核和报告形成过程，便于追溯最终结论。" />
      {stages.map((stage, index) => (
        <View key={`${stage.title}-${index}`} style={styles.appendixItem} wrap={false}>
          <Text style={styles.appendixMeta}>{index + 1}. {stage.title}</Text>
          <Text style={styles.appendixAnswer}>{stage.summary}</Text>
          {stage.evidence.length > 0 ? (
            <Text style={styles.sourceMeta}>依据：{stage.evidence.slice(0, 3).join("；")}</Text>
          ) : null}
          <View style={styles.pillRow}>{stage.tags.slice(0, 6).map(tag => <Text key={tag} style={styles.pill}>{tag}</Text>)}</View>
        </View>
      ))}
    </Page>
  )
}

function AppendixPages({ input, answers }: { input: CommercialReportInput; answers: FlattenedAnswer[] }) {
  if (input.detail !== "full" || answers.length === 0) return null
  const limited = answers.slice(0, 120)
  return (
    <Page size="A4" style={styles.page} wrap>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="APPENDIX" title="原始回答审计附录" intro={`按模型列出前 ${limited.length} 条回答；超长回答保留核心文本，完整原文仍可在系统中查看。`} />
      {limited.map(({ model, item }, index) => (
        <View key={`${model}-${index}-${item.question}`} style={styles.appendixItem}>
          <Text style={styles.appendixMeta}>{MODEL_LABELS[model]} · Q{index + 1} · {item.webVerified ? "联网可验证" : "联网未验证"}</Text>
          <Text style={styles.appendixQuestion}>{item.question}</Text>
          <Text style={styles.appendixAnswer}>{item.answer ? item.answer.slice(0, 700) : item.webFailureReason || "该回答未返回有效内容。"}</Text>
          {item.mentionedBrands.length > 0 ? (
            <View style={styles.pillRow}>{item.mentionedBrands.slice(0, 12).map(brand => <Text key={brand} style={styles.pill}>{brand}</Text>)}</View>
          ) : null}
        </View>
      ))}
    </Page>
  )
}

export function CommercialReportDocument({ input }: { input: CommercialReportInput }) {
  const answers = flattenAnswers(input)
  const sources = uniqueSources(answers)
  return (
    <Document title={`${input.client.name} GEO 商业报告`} author="杭州势途数字科技有限公司" subject="GEO 商业洞察报告" language="zh-CN">
      <CoverPage input={input} />
      <SummaryPage input={input} answers={answers} sources={sources} />
      {input.penetration ? <PenetrationPage input={input} answers={answers} /> : null}
      {input.penetration ? <PenetrationTablesPage input={input} /> : null}
      {input.penetration ? <QuestionCoveragePages input={input} answers={answers} /> : null}
      {input.penetration ? <PenetrationOpportunityPage input={input} /> : null}
      {input.penetration ? <SourcesPage input={input} answers={answers} sources={sources} /> : null}
      {input.penetration ? <SourceIndexPages input={input} sources={sources} /> : null}
      {input.difficulty ? <DifficultyPage input={input} /> : null}
      {input.difficulty ? <DifficultyDetailsPage input={input} /> : null}
      {input.difficulty ? <DifficultyInsightsPages input={input} /> : null}
      <ActionPage input={input} />
      <ProcessEvidencePage input={input} />
      <AppendixPages input={input} answers={answers} />
    </Document>
  )
}
