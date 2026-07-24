import path from "path"
import React from "react"
import {
  Circle,
  Document,
  Font,
  Image,
  Link,
  Line,
  Page,
  Polygon,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer"
import type {
  CommercialReportInput,
  CompetitorComparison,
  DifficultyContentCostEstimate,
  DifficultyDimensionResult,
  DifficultyLegacyCostEstimate,
  GeoAuditCheck,
  GeoAuditCheckStatus,
  GeoAuditDimension,
  ModelKey,
  PenetrationItem,
  PenetrationSource,
  ResearchDimension,
  ReportBrandingSettings,
} from "@/types"
import {
  isContentVolumeCostEstimate,
  isContentVolumeV3CostEstimate,
} from "@/lib/difficulty/content-cost-estimate"
import {
  DIFFICULTY_RING_COLORS,
  difficultyDimensionPercent,
} from "@/lib/difficulty/dimension-visuals"
import { reportPublisherLabel, resolveReportBranding } from "@/lib/report-branding"

const FONT_DIR = path.join(process.cwd(), "public", "fonts")
const SHITU_LOGO_PATH = path.join(process.cwd(), "public", "logo.jpg")
const COVER_BACKGROUND_PATH = path.join(process.cwd(), "public", "brand", "blue-diamond-hero-v2.png")

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
  ink: "#001D66",
  blue: "#1677FF",
  violet: "#2F54EB",
  amber: "#FFB020",
  silver: "#13C2C2",
  bronze: "#2F54EB",
  green: "#16C79A",
  paper: "#F5F9FF",
  line: "#D6E7FF",
  text: "#102A43",
  muted: "#5B6B85",
  white: "#FFFFFF",
  red: "#FF5B6E",
  cyan: "#00C8FF",
  slate: "#6E94C5",
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
    backgroundColor: "#FBFDFF",
    color: COLORS.text,
    fontFamily: "NotoSansSC",
    fontSize: 9,
  },
  cover: {
    position: "relative",
    width: 595.28,
    height: 841.89,
    minHeight: 841.89,
    maxHeight: 841.89,
    overflow: "hidden",
    padding: 0,
    backgroundColor: COLORS.ink,
    color: COLORS.white,
    fontFamily: "NotoSansSC",
  },
  coverBackground: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "48% 50%",
  },
  coverShade: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(1, 10, 45, 0.38)",
  },
  coverContent: {
    position: "relative",
    paddingTop: 48,
    paddingHorizontal: 48,
  },
  coverBrandRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
  },
  coverLogoBox: {
    width: 82,
    height: 58,
    padding: 6,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.96)",
  },
  coverLogo: { width: 70, height: 46, objectFit: "contain" },
  coverBrandRule: { width: 4, height: 48, borderRadius: 2, backgroundColor: COLORS.cyan },
  coverBrandText: { flex: 1, minWidth: 0, marginLeft: 13 },
  coverBrandName: { color: COLORS.white, fontSize: 14, fontWeight: 700, lineHeight: 1.3 },
  coverBrandMeta: { marginTop: 4, color: "#A8E8FF", fontSize: 7.5, lineHeight: 1.4 },
  coverSignal: {
    marginTop: 104,
    width: 86,
    height: 5,
    backgroundColor: COLORS.cyan,
    borderRadius: 2,
  },
  coverKicker: { marginTop: 18, color: "#8BE9FF", fontSize: 8, fontWeight: 700 },
  coverTitle: { marginTop: 8, maxWidth: 410, fontSize: 29, fontWeight: 700, lineHeight: 1.25 },
  coverSubtitle: { marginTop: 11, fontSize: 11, color: "#DDF7FF", lineHeight: 1.5 },
  coverMeta: {
    marginTop: 31,
    width: 360,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(139, 233, 255, 0.56)",
    gap: 8,
  },
  coverMetaRow: { flexDirection: "row" },
  coverMetaLabel: { width: 72, color: "#8BE9FF", fontSize: 8.5 },
  coverMetaValue: { flex: 1, minWidth: 0, color: COLORS.white, fontSize: 9.5, lineHeight: 1.35 },
  coverFooter: {
    position: "absolute",
    left: 48,
    right: 48,
    bottom: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    color: "#A8C8FF",
    fontSize: 8,
  },
  coverFooterLeft: { maxWidth: 330, lineHeight: 1.4 },
  coverFooterLink: { marginTop: 3, color: "#8BE9FF", fontSize: 7.5, textDecoration: "none" },
  header: {
    position: "absolute",
    top: 18,
    left: 38,
    right: 38,
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    alignItems: "center",
    borderBottomColor: "#A8D8FF",
    paddingBottom: 6,
    color: COLORS.muted,
    fontSize: 7,
  },
  headerBrand: { maxWidth: 310, flexDirection: "row", alignItems: "center" },
  headerLogo: { width: 18, height: 14, marginRight: 6, objectFit: "contain" },
  headerBrandText: { maxWidth: 285, color: COLORS.ink, fontSize: 7, fontWeight: 700 },
  headerClient: { maxWidth: 185, textAlign: "right" },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 38,
    right: 38,
    flexDirection: "row",
    justifyContent: "space-between",
    color: "#6684A8",
    fontSize: 7,
  },
  footerPublisher: { maxWidth: 390, flexDirection: "row", alignItems: "center" },
  footerLink: { marginLeft: 6, color: "#1677FF", fontSize: 7, textDecoration: "none" },
  chapterKicker: { fontSize: 8, fontWeight: 700, color: "#0958D9" },
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
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.blue,
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
    backgroundColor: "#E8F7FF",
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
    backgroundColor: "#0637A6",
  },
  signalLabel: { color: "#BAE0FF", fontSize: 7 },
  signalValue: { marginTop: 3, color: COLORS.white, fontSize: 12, fontWeight: 700 },
  barRow: { marginBottom: 8 },
  barHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  barLabel: { color: COLORS.text, fontSize: 8 },
  barValue: { color: COLORS.ink, fontSize: 8, fontWeight: 700 },
  barTrack: { height: 7, borderRadius: 3, backgroundColor: "#EAF3FF", overflow: "hidden" },
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
    borderBottomColor: "#F0F6FF",
  },
  sourceTitle: { maxWidth: "100%", color: COLORS.ink, fontSize: 8.5, fontWeight: 700 },
  sourceMeta: { maxWidth: "100%", marginTop: 2, color: COLORS.muted, fontSize: 7, lineHeight: 1.4 },
  sourceLink: { maxWidth: "100%", marginTop: 2, color: "#1677FF", fontSize: 7, lineHeight: 1.35, textDecoration: "none" },
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
    backgroundColor: "#EAF5FF",
    color: "#315B87",
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
    backgroundColor: COLORS.white,
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
  difficultyVisual: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  difficultyRingBox: { position: "relative", width: 196, height: 180, alignItems: "center", justifyContent: "center" },
  difficultyRingOverlay: { position: "absolute", top: 67, left: 0, width: 196, alignItems: "center" },
  difficultyRingValue: { color: COLORS.ink, fontSize: 21, fontWeight: 700, lineHeight: 1 },
  difficultyRingLabel: { marginTop: 3, color: COLORS.muted, fontSize: 6.2 },
  difficultyLegend: { flex: 1, minWidth: 0 },
  difficultyLegendRow: {
    minHeight: 22,
    marginBottom: 3,
    paddingVertical: 4,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 4,
    backgroundColor: "#F5FAFF",
  },
  difficultyLegendSwatch: { width: 4, height: 16, borderRadius: 2, marginRight: 6 },
  difficultyLegendCopy: { flex: 1, minWidth: 0 },
  difficultyLegendName: { color: COLORS.text, fontSize: 7.4, fontWeight: 700 },
  difficultyLegendMeta: { marginTop: 1.5, color: COLORS.muted, fontSize: 6.2 },
  difficultyLegendScore: { marginLeft: 5, color: COLORS.ink, fontSize: 8, fontWeight: 700 },
  difficultyMetaGrid: { flexDirection: "row", gap: 6, marginBottom: 12 },
  difficultyMetaCard: {
    width: "24%",
    minWidth: 0,
    minHeight: 42,
    padding: 7,
    borderRadius: 5,
    backgroundColor: COLORS.paper,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  difficultyMetaLabel: { color: COLORS.muted, fontSize: 6.4 },
  difficultyMetaValue: { marginTop: 4, color: COLORS.ink, fontSize: 9, fontWeight: 700, lineHeight: 1.25 },
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
  tableHeader: { backgroundColor: "#0637A6" },
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
  modulePills: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 15 },
  modulePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "#EAF5FF",
    color: "#0958D9",
    fontSize: 7,
    fontWeight: 700,
  },
  visualPanel: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  radarLayout: { flexDirection: "row", alignItems: "center", gap: 14 },
  radarBox: { width: 196, height: 190, alignItems: "center", justifyContent: "center" },
  radarLegend: { flex: 1, minWidth: 0 },
  radarLegendRow: {
    minHeight: 25,
    marginBottom: 3,
    paddingVertical: 4,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 4,
    backgroundColor: "#F5FAFF",
  },
  radarLegendDot: { width: 6, height: 6, marginRight: 6, borderRadius: 3, backgroundColor: COLORS.blue },
  radarLegendLabel: { flex: 1, minWidth: 0, color: COLORS.text, fontSize: 7.2, fontWeight: 700 },
  radarLegendScore: { marginLeft: 6, color: COLORS.ink, fontSize: 8, fontWeight: 700 },
  twoColumn: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  halfColumn: { width: "49%", minWidth: 0 },
  compactPanel: {
    marginBottom: 9,
    padding: 9,
    borderRadius: 6,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  compactPanelTitle: { marginBottom: 5, color: COLORS.ink, fontSize: 9, fontWeight: 700 },
  compactPanelText: { color: COLORS.text, fontSize: 7.7, lineHeight: 1.55 },
  compactListRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 5 },
  compactBullet: { width: 5, height: 5, marginTop: 4, marginRight: 6, borderRadius: 2.5, backgroundColor: COLORS.blue },
  compactListText: { flex: 1, minWidth: 0, color: COLORS.text, fontSize: 7.4, lineHeight: 1.48 },
  statusStrip: { flexDirection: "row", gap: 7, marginBottom: 14 },
  statusCard: {
    flex: 1,
    minWidth: 0,
    padding: 9,
    borderRadius: 6,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  statusCardLabel: { color: COLORS.muted, fontSize: 7 },
  statusCardValue: { marginTop: 4, color: COLORS.ink, fontSize: 15, fontWeight: 700 },
  auditCheck: {
    marginBottom: 9,
    padding: 10,
    borderRadius: 6,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  auditCheckHeader: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  auditCheckStatus: {
    width: 42,
    marginRight: 7,
    paddingVertical: 3,
    borderRadius: 8,
    textAlign: "center",
    color: COLORS.white,
    fontSize: 6.2,
    fontWeight: 700,
  },
  auditCheckTitle: { flex: 1, minWidth: 0, color: COLORS.ink, fontSize: 8.7, fontWeight: 700 },
  auditCheckScore: { marginLeft: 6, color: COLORS.ink, fontSize: 7.5, fontWeight: 700 },
  auditCheckSummary: { color: COLORS.text, fontSize: 7.6, lineHeight: 1.5 },
  auditCheckMeta: { marginTop: 4, color: COLORS.muted, fontSize: 6.8, lineHeight: 1.45 },
  auditLink: { marginTop: 3, color: COLORS.blue, fontSize: 6.8, lineHeight: 1.35, textDecoration: "none" },
  closingContent: {
    position: "relative",
    height: "100%",
    paddingHorizontal: 48,
    paddingTop: 68,
    paddingBottom: 46,
    justifyContent: "space-between",
  },
  closingTitle: { marginTop: 210, maxWidth: 390, color: COLORS.white, fontSize: 25, fontWeight: 700, lineHeight: 1.3 },
  closingText: { marginTop: 12, maxWidth: 360, color: "#C8DFFF", fontSize: 10, lineHeight: 1.6 },
  closingWebsite: { marginTop: 15, color: "#8BE9FF", fontSize: 9, textDecoration: "none" },
  closingFooter: { color: "#A8C8FF", fontSize: 8 },
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

function concisePeriod(value?: string | null): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim()
  if (/暂无|尚未|未形成/.test(normalized) || /(?:^|[^\d])0\s*(?:天|日)/.test(normalized)) {
    return "尚未形成稳定提及周期"
  }
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

function formatMoney(value: number): string {
  if (value >= 10_000) {
    const amount = value / 10_000
    return `\u00a5${Number.isInteger(amount) ? amount : amount.toFixed(1)}万`
  }
  return `\u00a5${Math.round(value).toLocaleString("zh-CN")}`
}

function formatMoneyRange(range: { min: number; max: number }): string {
  if (range.max >= 10_000) {
    const inWan = (value: number) => {
      const amount = value / 10_000
      return `${Number.isInteger(amount) ? amount : amount.toFixed(1)}万`
    }
    return `\u00a5${inWan(range.min)}-${inWan(range.max)}`
  }
  return `${formatMoney(range.min)}-${formatMoney(range.max).replace(/^\u00a5/, "")}`
}

function reportId(input: CommercialReportInput): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)
  return `GEO-${input.client.id.slice(0, 8).toUpperCase()}-${stamp}`
}

function brandingForInput(input: CommercialReportInput): ReportBrandingSettings {
  return resolveReportBranding(input.branding)
}

function logoForBranding(branding: ReportBrandingSettings): string | null {
  if (branding.mode === "shitu") return SHITU_LOGO_PATH
  return branding.logoDataUrl || null
}

function displayWebsite(value: string): string {
  return value.replace(/^https?:\/\//i, "").replace(/\/$/, "")
}

function publisherNameFontSize(value: string): number {
  const length = Array.from(value).length
  if (length <= 14) return 14
  if (length <= 24) return 12
  if (length <= 38) return 10
  return 8.5
}

function inlinePublisherFontSize(value: string): number {
  const length = Array.from(value).length
  if (length <= 26) return 7
  if (length <= 42) return 6
  if (length <= 64) return 5.2
  return 4.5
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

function sampleConfidenceLabel(value?: "low" | "medium" | "high"): string {
  if (value === "high") return "标准可信"
  if (value === "medium") return "方向性"
  return "探索性"
}

function isPersonReport(input: CommercialReportInput): boolean {
  return input.client.subjectType === "person"
}

function reportVocabulary(input: CommercialReportInput) {
  return isPersonReport(input)
    ? {
        subject: "人物",
        target: "目标人物",
        visibility: "个人 IP 被提及率",
        ranking: "同行人物声量排名",
        competitors: "同行人物",
        assets: "专业身份与内容资产",
      }
    : {
        subject: "品牌",
        target: "目标品牌",
        visibility: "品牌被提及率",
        ranking: "品牌声量排名",
        competitors: "竞品",
        assets: "品牌资产",
      }
}

function reportModuleLabels(input: CommercialReportInput): string[] {
  const modules: string[] = []
  if (input.penetration) modules.push("渗透率情报")
  if (input.research || input.competitorCompare) modules.push("独立调研")
  if (input.diagnosis) modules.push("AI 诊断")
  if (input.difficulty) modules.push("难度测评")
  return modules
}

function competitorComparisons(input: CommercialReportInput): CompetitorComparison[] {
  const result = input.competitorCompare
  if (!result) return []
  if (result.comparisons?.length) return result.comparisons
  if (!result.competitor) return []
  return [{
    competitor: result.competitor,
    positioningSummary: result.positioningSummary,
    ourAdvantages: result.ourAdvantages,
    competitorAdvantages: result.competitorAdvantages,
    ourWeaknesses: result.ourWeaknesses,
    competitorWeaknesses: result.competitorWeaknesses,
    differentiators: result.differentiators,
    userChoiceDrivers: result.userChoiceDrivers,
    contentActions: result.contentActions,
  }]
}

function averageResearchScore(input: CommercialReportInput): number | null {
  const dimensions = input.research?.dimensions || []
  if (dimensions.length === 0) return null
  return Math.round(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length)
}

function executiveSummary(input: CommercialReportInput, answers: FlattenedAnswer[]): string {
  const sections: string[] = []
  const penetration = input.penetration?.aggregated
  if (penetration) {
    const terms = reportVocabulary(input)
    const rank = penetration.ourRanking
      ? `${terms.ranking}位列第 ${penetration.ourRanking}`
      : `当前未进入${terms.ranking}`
    sections.push(
      `本次多模型检测覆盖 ${distinctQuestions(answers)} 条疑问句、${penetration.perModelRate.length} 个模型和 ${penetration.totalSlots} 个有效检测槽位；`
      + `${terms.visibility}为 ${percent(penetration.penetrationRate)}`
      + (penetration.categoryBalancedRate != null ? `，七类问题均衡率为 ${percent(penetration.categoryBalancedRate)}` : "")
      + `，样本属于${sampleConfidenceLabel(penetration.sampleQuality?.confidence)}结果，${rank}。`,
    )
  }
  if (input.research) {
    sections.push(`独立调研结论：${input.research.executiveSummary}`)
  }
  const comparisons = competitorComparisons(input)
  if (comparisons.length > 0) {
    sections.push(`竞品对比覆盖 ${comparisons.length} 个主要竞争主体，已分别整理定位、优势、短板、差异点和内容动作。`)
  }
  if (input.diagnosis) {
    const audit = input.diagnosis.audit
    if (audit) {
      const blockers = audit.checks.filter(check => check.status === "fail").length
      const warnings = audit.checks.filter(check => check.status === "warning").length
      sections.push(`AI 诊断总分为 ${audit.score} 分，可信度为${audit.confidenceLabel}；发现 ${blockers} 项未通过、${warnings} 项需优化，诊断覆盖 ${audit.pagesFetched}/${audit.pagesRequested} 个计划页面。`)
    } else {
      sections.push(`AI 诊断历史评分为 ${input.diagnosis.gemScore} 分，具体结论按当时保存的五维口径呈现。`)
    }
  }
  if (input.difficulty) {
    const cost = input.difficulty.result.costEstimate
    const costSummary = cost
      ? isContentVolumeCostEstimate(cost)
        ? (() => {
            const stable = cost.milestones.find(item => item.key === "stableMention")
            return stable ? `稳定提及累计执行成本估算为 ${formatMoneyRange(stable.cumulativeCost)}。` : ""
          })()
        : `90 天稳定期预算估算为 ${formatMoneyRange(cost.stabilization90Days)}。`
      : ""
    sections.push(
      `难度测评总分为 ${input.difficulty.result.totalScore} 分，等级为“${input.difficulty.result.level}”，稳定提及周期判断为 ${concisePeriod(input.difficulty.result.stableMentionPeriod)}。${costSummary}`,
    )
  }
  if (answers.length > 0) {
    sections.push(`联网可验证率为 ${percent(verifiedRate(answers))}，本报告仅基于已保存的检测结果和可核验来源生成。`)
  }
  return sections.join("") || "当前客户尚未生成可用于报告的检测或难度测评数据。"
}

function actionItems(input: CommercialReportInput): string[] {
  const actions: string[] = []
  const auditChecks = input.diagnosis?.audit?.checks || []
  for (const check of auditChecks
    .filter(item => item.status === "fail" || item.status === "warning")
    .sort((a, b) => ({ P0: 0, P1: 1, P2: 2 }[a.priority] - { P0: 0, P1: 1, P2: 2 }[b.priority]))) {
    if (check.recommendation.trim()) actions.push(check.recommendation.trim())
    if (actions.length >= 4) break
  }
  for (const recommendation of input.research?.recommendations || []) {
    if (recommendation.trim()) actions.push(recommendation.trim())
    if (actions.length >= 6) break
  }
  for (const comparison of competitorComparisons(input)) {
    for (const action of comparison.contentActions) {
      if (action.trim()) actions.push(action.trim())
      if (actions.length >= 7) break
    }
    if (actions.length >= 7) break
  }
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
    actions.push(
      isPersonReport(input)
        ? `针对高频同行人物“${topCompetitor}”建立差异化专业证据页，明确可验证的资历、专长、案例与服务边界。`
        : `针对高频竞品“${topCompetitor}”建立差异化证据页，明确可验证的产品、案例和服务边界。`,
    )
  }
  if (actions.length === 0) actions.push("完成更多疑问句检测和难度测评后，再形成分阶段 GEO 行动路线。")
  return Array.from(new Set(actions)).slice(0, 8)
}

function HeaderFooter({ input }: { input: CommercialReportInput }) {
  const branding = brandingForInput(input)
  const logo = logoForBranding(branding)
  const publisher = reportPublisherLabel(branding)
  return (
    <>
      <View style={styles.header} fixed>
        <View style={styles.headerBrand}>
          {logo ? (
            // react-pdf Image is not a DOM img and has no alt prop.
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={logo} style={styles.headerLogo} />
          ) : null}
          <Text style={[styles.headerBrandText, { fontSize: inlinePublisherFontSize(publisher) }]}>{publisher} · GEO 商业洞察报告</Text>
        </View>
        <Text style={styles.headerClient}>{input.client.name} · {input.client.industry || "未填写行业"}</Text>
      </View>
      <View style={styles.footer} fixed>
        <View style={styles.footerPublisher}>
          <Text style={{ fontSize: inlinePublisherFontSize(branding.companyName), lineHeight: 1.2 }}>{branding.companyName} · 内部与客户授权使用</Text>
          {branding.website ? <Link src={branding.website} style={styles.footerLink}>{displayWebsite(branding.website)}</Link> : null}
        </View>
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
        <Circle cx={56} cy={56} r={radius} fill="none" stroke="#D6E7FF" strokeWidth={12} />
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

function DifficultyDimensionsRing({
  dimensions,
  totalScore,
}: {
  dimensions: DifficultyDimensionResult[]
  totalScore: number
}) {
  const data = dimensions.map((dimension, index) => ({
    ...dimension,
    color: DIFFICULTY_RING_COLORS[index % DIFFICULTY_RING_COLORS.length],
    percent: difficultyDimensionPercent(dimension.score, dimension.max),
  }))
  const center = 90
  const outerRadius = 76
  const ringStep = 8
  const strokeWidth = 5.5

  return (
    <View style={styles.difficultyVisual} wrap={false}>
      <View style={styles.difficultyRingBox}>
        <Svg width={180} height={180} viewBox="0 0 180 180">
          {data.map((dimension, index) => {
            const radius = outerRadius - index * ringStep
            const circumference = 2 * Math.PI * radius
            const progress = circumference * dimension.percent / 100
            const partialDash = dimension.percent > 0 && dimension.percent < 100
            return (
              <React.Fragment key={`${dimension.name}-${index}`}>
                <Circle
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke="#DFEAF5"
                  strokeWidth={strokeWidth}
                />
                {dimension.percent > 0 ? (
                  <Circle
                    cx={center}
                    cy={center}
                    r={radius}
                    fill="none"
                    stroke={dimension.color}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeDasharray={partialDash ? `${progress} ${circumference - progress}` : undefined}
                    transform={`rotate(-90 ${center} ${center})`}
                  />
                ) : null}
              </React.Fragment>
            )
          })}
        </Svg>
        <View style={styles.difficultyRingOverlay}>
          <Text style={styles.difficultyRingValue}>{totalScore}</Text>
          <Text style={styles.difficultyRingLabel}>总分 / 100</Text>
        </View>
      </View>
      <View style={styles.difficultyLegend}>
        {data.map((dimension, index) => (
          <View key={`${dimension.name}-legend-${index}`} style={styles.difficultyLegendRow}>
            <View style={[styles.difficultyLegendSwatch, { backgroundColor: dimension.color }]} />
            <View style={styles.difficultyLegendCopy}>
              <Text style={styles.difficultyLegendName}>{dimension.name}</Text>
              <Text style={styles.difficultyLegendMeta}>{dimension.level} · 完成度 {dimension.percent}%</Text>
            </View>
            <Text style={styles.difficultyLegendScore}>{dimension.score}/{dimension.max}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function DifficultyMeta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.difficultyMetaCard} wrap={false}>
      <Text style={styles.difficultyMetaLabel}>{label}</Text>
      <Text style={styles.difficultyMetaValue}>{value}</Text>
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

function radarPoints(values: number[], radius: number, center = 90): string {
  const count = Math.max(3, values.length)
  return values.map((value, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count
    const normalized = Math.max(0, Math.min(1, value))
    return `${center + Math.cos(angle) * radius * normalized},${center + Math.sin(angle) * radius * normalized}`
  }).join(" ")
}

function RadarScoreChart({ dimensions }: { dimensions: GeoAuditDimension[] }) {
  const values = dimensions.map(item => item.maxScore > 0 ? item.score / item.maxScore : 0)
  const axisValues = dimensions.map(() => 1)
  const center = 90
  const radius = 70
  return (
    <View style={styles.radarLayout} wrap={false}>
      <View style={styles.radarBox}>
        <Svg width={180} height={180} viewBox="0 0 180 180">
          {[0.25, 0.5, 0.75, 1].map(level => (
            <Polygon
              key={level}
              points={radarPoints(axisValues.map(() => level), radius, center)}
              fill="none"
              stroke={level === 1 ? "#B9D8F8" : "#DCEBFA"}
              strokeWidth={level === 1 ? 1.2 : 0.8}
            />
          ))}
          {dimensions.map((dimension, index) => {
            const angle = -Math.PI / 2 + (Math.PI * 2 * index) / dimensions.length
            return (
              <Line
                key={dimension.key}
                x1={center}
                y1={center}
                x2={center + Math.cos(angle) * radius}
                y2={center + Math.sin(angle) * radius}
                stroke="#D2E6F9"
                strokeWidth={0.8}
              />
            )
          })}
          <Polygon
            points={radarPoints(values, radius, center)}
            fill="#1677FF"
            fillOpacity={0.28}
            stroke="#1677FF"
            strokeWidth={2}
          />
        </Svg>
      </View>
      <View style={styles.radarLegend}>
        {dimensions.map(dimension => (
          <View key={dimension.key} style={styles.radarLegendRow}>
            <View style={styles.radarLegendDot} />
            <Text style={styles.radarLegendLabel}>{dimension.label}</Text>
            <Text style={styles.radarLegendScore}>{dimension.score}/{dimension.maxScore}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function ResearchScoreBars({ dimensions }: { dimensions: ResearchDimension[] }) {
  const colors = [COLORS.blue, COLORS.cyan, COLORS.violet, COLORS.green, COLORS.amber, COLORS.silver]
  return (
    <View style={styles.visualPanel} wrap={false}>
      {dimensions.map((dimension, index) => (
        <HorizontalBar
          key={`${dimension.name}-${index}`}
          label={dimension.name}
          value={Math.max(0, Math.min(100, dimension.score)) / 100}
          display={`${Math.round(dimension.score)} 分`}
          color={colors[index % colors.length]}
        />
      ))}
    </View>
  )
}

function CompactList({ items, color = COLORS.blue }: { items: string[]; color?: string }) {
  return (
    <View>
      {items.map((item, index) => (
        <View key={`${index}-${item}`} style={styles.compactListRow} wrap={false}>
          <View style={[styles.compactBullet, { backgroundColor: color }]} />
          <Text style={styles.compactListText}>{item}</Text>
        </View>
      ))}
    </View>
  )
}

function auditStatusMeta(status: GeoAuditCheckStatus): { label: string; color: string } {
  if (status === "pass") return { label: "已通过", color: COLORS.green }
  if (status === "warning") return { label: "需优化", color: COLORS.amber }
  if (status === "fail") return { label: "未通过", color: COLORS.red }
  return { label: "不适用", color: COLORS.slate }
}

function AuditCheckCard({ check }: { check: GeoAuditCheck }) {
  const status = auditStatusMeta(check.status)
  return (
    <View style={styles.auditCheck} wrap={false}>
      <View style={styles.auditCheckHeader}>
        <Text style={[styles.auditCheckStatus, { backgroundColor: status.color }]}>{status.label}</Text>
        <Text style={styles.auditCheckTitle}>{check.label} · {check.priority}</Text>
        <Text style={styles.auditCheckScore}>{check.score}/{check.maxScore}</Text>
      </View>
      <Text style={styles.auditCheckSummary}>{check.summary}</Text>
      {check.evidence.length > 0 ? <Text style={styles.auditCheckMeta}>证据：{check.evidence.join("；")}</Text> : null}
      <Text style={styles.auditCheckMeta}>建议：{check.recommendation}</Text>
      {check.urls.map((url, index) => (
        <Link key={`${url}-${index}`} src={url} style={styles.auditLink}>页面 {index + 1}：{url}</Link>
      ))}
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

function PublisherLockup({ branding }: { branding: ReportBrandingSettings }) {
  const logo = logoForBranding(branding)
  const publisher = reportPublisherLabel(branding)
  const meta = branding.mode === "shitu"
    ? branding.companyName
    : branding.website ? displayWebsite(branding.website) : "CUSTOM REPORT PUBLISHER"
  return (
    <View style={styles.coverBrandRow}>
      {logo ? (
        <View style={styles.coverLogoBox}>
          {/* react-pdf Image is not a DOM img and has no alt prop. */}
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={logo} style={styles.coverLogo} />
        </View>
      ) : <View style={styles.coverBrandRule} />}
      <View style={styles.coverBrandText}>
        <Text style={[styles.coverBrandName, { fontSize: publisherNameFontSize(publisher) }]}>{publisher}</Text>
        <Text style={styles.coverBrandMeta}>{meta}</Text>
      </View>
    </View>
  )
}

function CoverPage({ input }: { input: CommercialReportInput }) {
  const branding = brandingForInput(input)
  const terms = reportVocabulary(input)
  const kindLabel: Record<CommercialReportInput["kind"], string> = {
    combined: "GEO 四模块综合报告",
    penetration: "GEO 渗透率情报报告",
    research: "GEO 独立调研报告",
    diagnosis: "GEO AI 诊断报告",
    difficulty: "GEO 难度测评报告",
  }
  return (
    <Page size="A4" style={styles.cover} wrap={false}>
      {/* react-pdf Image is not a DOM img and has no alt prop. */}
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <Image src={COVER_BACKGROUND_PATH} style={styles.coverBackground} />
      <View style={styles.coverShade} />
      <View style={styles.coverContent}>
        <PublisherLockup branding={branding} />
        <View style={styles.coverSignal} />
        <Text style={styles.coverKicker}>GEO INTELLIGENCE REPORT</Text>
        <Text style={styles.coverTitle}>{kindLabel[input.kind]}</Text>
        <Text style={styles.coverSubtitle}>
          {isPersonReport(input)
            ? "AI 专业认知 · 个人 IP 可见度 · 同行竞争 · 行动路径"
            : "AI 心智占位 · 品牌可见度 · 竞争难度 · 行动路径"}
        </Text>
        <View style={styles.coverMeta}>
          <View style={styles.coverMetaRow}><Text style={styles.coverMetaLabel}>客户</Text><Text style={styles.coverMetaValue}>{input.client.name}</Text></View>
          <View style={styles.coverMetaRow}><Text style={styles.coverMetaLabel}>{terms.target}</Text><Text style={styles.coverMetaValue}>{input.client.ourBrand || "未填写"}</Text></View>
          <View style={styles.coverMetaRow}><Text style={styles.coverMetaLabel}>行业</Text><Text style={styles.coverMetaValue}>{input.client.industry || "未填写"}</Text></View>
          <View style={styles.coverMetaRow}><Text style={styles.coverMetaLabel}>报告版本</Text><Text style={styles.coverMetaValue}>{input.detail === "full" ? "完整证据版" : "精简决策版"}</Text></View>
          <View style={styles.coverMetaRow}><Text style={styles.coverMetaLabel}>生成时间</Text><Text style={styles.coverMetaValue}>{formatDate(new Date().toISOString())}</Text></View>
        </View>
      </View>
      <View style={styles.coverFooter}>
        <View style={styles.coverFooterLeft}>
          <Text>CONFIDENTIAL · {branding.companyName}</Text>
          {branding.website ? <Link src={branding.website} style={styles.coverFooterLink}>{displayWebsite(branding.website)}</Link> : null}
        </View>
        <Text>{reportId(input)}</Text>
      </View>
    </Page>
  )
}

function SummaryPage({ input, answers, sources }: { input: CommercialReportInput; answers: FlattenedAnswer[]; sources: PenetrationSource[] }) {
  const penetration = input.penetration?.aggregated
  const difficulty = input.difficulty?.result
  const terms = reportVocabulary(input)
  const modules = reportModuleLabels(input)
  const researchAverage = averageResearchScore(input)
  const comparisons = competitorComparisons(input)
  const audit = input.diagnosis?.audit
  const auditIssues = audit?.checks.filter(check => check.status === "fail" || check.status === "warning").length || 0
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle
        kicker="EXECUTIVE VIEW"
        title="管理层摘要"
        intro={isPersonReport(input)
          ? "把复杂模型检测压缩为可决策的个人专业认知与同行竞争信号。"
          : "把复杂模型检测压缩为可决策的品牌心智信号。"}
      />
      <View style={styles.modulePills}>
        {modules.map(module => <Text key={module} style={styles.modulePill}>{module} · 已纳入</Text>)}
      </View>
      <View style={styles.metricsGrid}>
        {penetration ? (
          <>
            <MetricCard
              label={terms.visibility}
              value={percent(penetration.penetrationRate)}
              note={`${penetration.ourMentions}/${penetration.totalSlots} 个槽位命中 · ${penetration.ourRanking ? `${terms.ranking}第 ${penetration.ourRanking}` : "未上榜"}`}
            />
            <MetricCard
              label="样本可信度"
              value={sampleConfidenceLabel(penetration.sampleQuality?.confidence)}
              note={penetration.sampleQuality
                ? `${penetration.sampleQuality.semanticIntentCount} 类有效问题 · 完成率 ${percent(penetration.sampleQuality.completionRate)}`
                : `${sources.length} 条去重信源`}
            />
          </>
        ) : null}
        {input.research ? (
          <MetricCard
            label="独立调研维度均分"
            value={researchAverage == null ? "已完成" : `${researchAverage} 分`}
            note={`${input.research.dimensions.length} 个认知维度 · ${input.research.evidenceGaps.length} 项证据缺口`}
          />
        ) : null}
        {comparisons.length > 0 ? (
          <MetricCard label="竞品对比" value={`${comparisons.length} 个`} note="定位、优势、短板、差异点与行动建议" />
        ) : null}
        {input.diagnosis ? (
          <MetricCard
            label="AI 诊断"
            value={`${audit?.score ?? input.diagnosis.gemScore} 分`}
            note={audit ? `${auditIssues} 项待处理 · ${audit.confidenceLabel}` : "历史五维诊断口径"}
          />
        ) : null}
        {difficulty ? (
          <MetricCard label="GEO 难度" value={`${difficulty.totalScore} 分`} note={`${difficulty.level} · ${concisePeriod(difficulty.stableMentionPeriod)}`} />
        ) : null}
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
  const terms = reportVocabulary(input)
  const maxBrandRate = Math.max(0.01, ...brands.map(item => item.penetrationRate))
  const rankColors = [COLORS.amber, COLORS.silver, COLORS.bronze]
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle
        kicker="VISIBILITY INTELLIGENCE"
        title={isPersonReport(input) ? "个人 IP 可见度与同行情报" : "渗透率与竞品情报"}
        intro={`覆盖 ${distinctQuestions(answers)} 条疑问句和 ${penetration.aggregated.perModelRate.length} 个模型，统计口径为模型回答中的${terms.subject}真实提及。`}
      />
      <View style={styles.penetrationHero} wrap={false}>
        <DonutChart
          value={penetration.aggregated.penetrationRate}
          display={percent(penetration.aggregated.penetrationRate)}
          label={terms.visibility}
        />
        <View style={styles.heroMetrics}>
          <HeroMetric label={`${terms.target}命中`} value={`${penetration.aggregated.ourMentions}/${penetration.aggregated.totalSlots}`} />
          <HeroMetric label={terms.ranking} value={penetration.aggregated.ourRanking ? `第 ${penetration.aggregated.ourRanking}` : "未上榜"} />
          <HeroMetric label="七类问题均衡率" value={penetration.aggregated.categoryBalancedRate != null ? percent(penetration.aggregated.categoryBalancedRate) : "历史口径"} />
          <HeroMetric label="样本可信度" value={sampleConfidenceLabel(penetration.aggregated.sampleQuality?.confidence)} />
        </View>
      </View>
      <View style={styles.section} wrap={false}>
        <Text style={styles.sectionTitle}>
          {isPersonReport(input) ? "同行人物可见度" : "全品牌渗透率"} Top {brands.length}
        </Text>
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
        <Text>
          {isPersonReport(input)
            ? "统计说明：目标人物姓名及已配置别名在回答原文中通过字面校验后才计为命中；同行人物由独立裁判结合职业、专业方向与回答上下文判定，机构不计入人物排名。失败或空回答不会被包装成成功结果。"
            : "统计说明：目标品牌全称及已配置别名在回答原文中通过字面校验后才计为命中。失败或空回答不会被包装成成功结果。"}
        </Text>
        <Text style={{ marginTop: 4 }}>
          每个问题都会独立获得联网回答；同义问题在汇总时归为一类，避免重复问题放大结果；七类问题会分别计算后再综合汇总。
        </Text>
      </View>
    </Page>
  )
}

function PenetrationTablesPage({ input }: { input: CommercialReportInput }) {
  const penetration = input.penetration!
  const brands = penetration.aggregated.industryShare.slice(0, 10)
  const institutions = (penetration.aggregated.institutionShare || []).slice(0, 8)
  const terms = reportVocabulary(input)
  const models = penetration.aggregated.perModelRate
  const rankColors = [COLORS.amber, COLORS.silver, COLORS.bronze]
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle
        kicker="DATA TABLES"
        title={`${terms.subject}与模型数据表`}
        intro="把图表中的相对位置还原为可复核的次数、比例与模型覆盖口径。"
      />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {isPersonReport(input) ? "同行人物可见度" : "全品牌渗透率"} Top {brands.length}
        </Text>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <TableCell width="10%" header>排名</TableCell>
            <TableCell width="44%" header>{terms.subject}</TableCell>
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
        <Text style={styles.sectionTitle}>各模型{terms.target}命中率</Text>
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
      {isPersonReport(input) && institutions.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>关联机构提及 Top {institutions.length}</Text>
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeader]}>
              <TableCell width="12%" header>排名</TableCell>
              <TableCell width="50%" header>机构</TableCell>
              <TableCell width="18%" header>提及</TableCell>
              <TableCell width="20%" header>提及率</TableCell>
            </View>
            {institutions.map((item, index) => (
              <View key={item.brand} style={[styles.tableRow, index === institutions.length - 1 ? styles.tableLastRow : {}]} wrap={false}>
                <TableCell width="12%">{index + 1}</TableCell>
                <TableCell width="50%" strong>{item.brand}</TableCell>
                <TableCell width="18%">{item.count} 次</TableCell>
                <TableCell width="20%">{percent(item.penetrationRate)}</TableCell>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </Page>
  )
}

function QuestionCoveragePages({ input, answers }: { input: CommercialReportInput; answers: FlattenedAnswer[] }) {
  const rows = questionCoverageRows(answers)
  const terms = reportVocabulary(input)
  const limit = input.detail === "full" ? rows.length : 20
  const pages = paginateQuestionRows(rows.slice(0, limit))
  return pages.map((pageRows, pageIndex) => (
    <Page key={`question-coverage-${pageIndex}`} size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle
        kicker="QUESTION COVERAGE"
        title={pageIndex === 0 ? "疑问句覆盖明细" : "疑问句覆盖明细（续）"}
        intro={`逐题汇总${terms.target}命中、联网可验证回答和信源数量，便于定位优先补强的问题。`}
      />
      <Text style={styles.continuationLabel}>第 {pageIndex + 1} 组 · 共 {Math.min(rows.length, limit)} 条问题</Text>
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <TableCell width="58%" header>疑问句</TableCell>
          <TableCell width="14%" header>{terms.subject}命中</TableCell>
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
  const terms = reportVocabulary(input)
  const competitors = (penetration.aggregated.topCompetitors || []).slice(0, 8)
    .map(item => `${item} 在本轮回答中形成较高频的模型心智占位。`)
  const missed = (penetration.aggregated.missedQuestions || []).slice(0, 14)
  if (competitors.length === 0 && missed.length === 0) return null
  return (
    <Page size="A4" style={styles.page} wrap>
      <HeaderFooter input={input} />
      <ChapterTitle
        kicker="GAP ANALYSIS"
        title="竞争与问题缺口"
        intro={isPersonReport(input)
          ? "把人物声量差距转化为可执行的同行对照与疑问句补强清单。"
          : "把品牌声量差距转化为可执行的竞品对照与疑问句补强清单。"}
      />
      {competitors.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>主要{terms.competitors}</Text>
          <NumberedList items={competitors} />
        </View>
      ) : null}
      {missed.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{terms.target}未覆盖疑问句</Text>
          <NumberedList items={missed} />
        </View>
      ) : null}
    </Page>
  )
}

function SourcesPage({ input, answers, sources }: { input: CommercialReportInput; answers: FlattenedAnswer[]; sources: PenetrationSource[] }) {
  const domains = sourceDomainCounts(sources)
  const diversity = input.penetration?.aggregated.sampleQuality?.sourceDiversity
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="EVIDENCE" title="联网来源与证据" intro="先展示联网回答覆盖和来源结构，再列出可以直接打开的具体网址。" />
      <View style={styles.metricsGrid}>
        <MetricCard label="联网可验证回答" value={`${answers.filter(({ item }) => item.webVerified).length}/${answers.length}`} />
        <MetricCard label="引用事件" value={`${diversity?.citationEvents ?? sources.length}`} note="不同模型重复采信会分别计数" />
        <MetricCard label="唯一网址" value={`${diversity?.uniqueUrlCount ?? sources.length}`} note={`重复引用占比 ${percent(diversity?.duplicateCitationRate || 0)}`} />
        <MetricCard label="不同来源网站" value={`${diversity?.uniqueDomainCount ?? domains.length}`} note={`独立纯净提问 ${answers.filter(({ item }) => item.promptPurity === "raw_question_only").length}/${answers.length}`} />
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>不同网址最多的来源域名</Text>
        {domains.slice(0, 12).map((item, index) => (
          <HorizontalBar key={item.domain} label={item.domain} value={item.count / Math.max(1, domains[0]?.count || 1)} display={`${item.count} 个网址`} color={index < 3 ? [COLORS.amber, COLORS.silver, COLORS.bronze][index] : COLORS.slate} />
        ))}
      </View>
      <View style={styles.methodology}>
        <Text>信源说明：引用事件用于观察不同模型和问题对来源的重复采信；唯一网址、唯一域名用于观察证据多样性。可点击索引按完整网址去重，二者不能混为同一指标。</Text>
      </View>
    </Page>
  )
}

function SourceIndexPages({ input, sources }: { input: CommercialReportInput; sources: PenetrationSource[] }) {
  const sourceLimit = input.detail === "full" ? sources.length : 24
  const visible = sources.slice(0, sourceLimit)
  const pages = chunk(visible, 12)
  return pages.map((pageSources, pageIndex) => (
    <Page key={`source-index-${pageIndex}`} size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle
        kicker="SOURCE INDEX"
        title={pageIndex === 0 ? "可点击来源列表" : "可点击来源列表（续）"}
        intro="每条来源均保留网页标题、网站、相关问题与具体网址，可直接打开查看。"
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
        <Text style={styles.tableNote}>当前版本展示前 {sourceLimit} 条来源，完整内容可在系统的原始联网回答中查看。</Text>
      ) : null}
    </Page>
  ))
}

function ResearchOverviewPage({ input }: { input: CommercialReportInput }) {
  const result = input.research!
  const modeLabel = result.mode === "hypothesis" ? "判断验证" : "全面调研"
  const sourceModeLabel = result.sourceMode === "manual" ? "手动填写资料" : "当前客户资料"
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle
        kicker="INDEPENDENT RESEARCH"
        title={isPersonReport(input) ? "个人 IP 独立调研" : "品牌独立调研"}
        intro="完整呈现当前认知、模型心智、维度评分及调研结论，不在导出时重新生成或改写数据。"
      />
      <View style={styles.statusStrip}>
        <View style={styles.statusCard}><Text style={styles.statusCardLabel}>调研模式</Text><Text style={styles.statusCardValue}>{modeLabel}</Text></View>
        <View style={styles.statusCard}><Text style={styles.statusCardLabel}>地区</Text><Text style={styles.statusCardValue}>{result.region || "未指定"}</Text></View>
        <View style={styles.statusCard}><Text style={styles.statusCardLabel}>评分维度</Text><Text style={styles.statusCardValue}>{result.dimensions.length} 个</Text></View>
        <View style={styles.statusCard}><Text style={styles.statusCardLabel}>生成时间</Text><Text style={[styles.statusCardValue, { fontSize: 8.5 }]}>{formatDateToMinute(result.generatedAt)}</Text></View>
      </View>
      <View style={styles.compactPanel} wrap={false}>
        <Text style={styles.compactPanelTitle}>调研对象口径</Text>
        <Text style={styles.compactPanelText}>资料来源：{sourceModeLabel}{result.aliases?.length ? `；对象别名：${result.aliases.join("、")}` : "；未填写对象别名"}</Text>
      </View>
      {result.hypothesis ? (
        <View style={styles.compactPanel} wrap={false}>
          <Text style={styles.compactPanelTitle}>本次验证判断</Text>
          <Text style={styles.compactPanelText}>{result.hypothesis}</Text>
        </View>
      ) : null}
      <View style={styles.insightBox} wrap={false}>
        <Text style={styles.insightTitle}>调研结论</Text>
        <Text style={styles.insightText}>{result.executiveSummary}</Text>
      </View>
      <View style={styles.twoColumn}>
        <View style={styles.halfColumn}>
          <View style={styles.compactPanel} wrap={false}>
            <Text style={styles.compactPanelTitle}>{isPersonReport(input) ? "个人 IP 形象" : "品牌形象"}</Text>
            <Text style={styles.compactPanelText}>{result.brandImage}</Text>
          </View>
        </View>
        <View style={styles.halfColumn}>
          <View style={styles.compactPanel} wrap={false}>
            <Text style={styles.compactPanelTitle}>当前模型认知</Text>
            <Text style={styles.compactPanelText}>{result.modelMentality}</Text>
          </View>
        </View>
      </View>
      {result.dimensions.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>调研维度评分</Text>
          <ResearchScoreBars dimensions={result.dimensions} />
        </View>
      ) : null}
    </Page>
  )
}

function ResearchDimensionEvidencePages({ input }: { input: CommercialReportInput }) {
  const dimensions = input.research?.dimensions || []
  return chunk(dimensions, 4).map((pageDimensions, pageIndex) => (
    <Page key={`research-dimensions-${pageIndex}`} size="A4" style={styles.page} wrap>
      <HeaderFooter input={input} />
      <ChapterTitle
        kicker="RESEARCH EVIDENCE"
        title={pageIndex === 0 ? "调研维度与依据" : "调研维度与依据（续）"}
        intro="每个维度保留原始洞察与证据，便于客户理解评分依据。"
      />
      {pageDimensions.map((dimension, index) => (
        <View key={`${dimension.name}-${index}`} style={styles.auditCheck} wrap={false}>
          <View style={styles.auditCheckHeader}>
            <Text style={[styles.auditCheckStatus, { backgroundColor: COLORS.blue }]}>{Math.round(dimension.score)} 分</Text>
            <Text style={styles.auditCheckTitle}>{dimension.name}</Text>
          </View>
          <Text style={styles.auditCheckSummary}>{dimension.insight}</Text>
          {dimension.evidence.length > 0 ? <Text style={styles.auditCheckMeta}>依据：{dimension.evidence.join("；")}</Text> : null}
        </View>
      ))}
    </Page>
  ))
}

function ResearchFindingsPages({ input }: { input: CommercialReportInput }) {
  const result = input.research!
  const sections = [
    { title: "用户感知", items: result.audiencePerception, color: COLORS.cyan },
    { title: "信任信号", items: result.trustSignals, color: COLORS.green },
    { title: "证据缺口", items: result.evidenceGaps, color: COLORS.amber },
    { title: "风险暴露", items: result.risks, color: COLORS.red },
    { title: "增长机会", items: result.opportunities, color: COLORS.violet },
    { title: "行动建议", items: result.recommendations, color: COLORS.blue },
  ].filter(section => section.items.length > 0)
  return chunk(sections, 2).map((pageSections, pageIndex) => (
    <Page key={`research-findings-${pageIndex}`} size="A4" style={styles.page} wrap>
      <HeaderFooter input={input} />
      <ChapterTitle
        kicker="RESEARCH FINDINGS"
        title={pageIndex === 0 ? "调研发现与行动" : "调研发现与行动（续）"}
        intro="把认知信号、证据缺口和增长机会转化为可检查、可执行的清单。"
      />
      {pageSections.map(section => (
        <View key={section.title} style={styles.compactPanel} wrap={false}>
          <Text style={styles.compactPanelTitle}>{section.title} · {section.items.length} 项</Text>
          <CompactList items={section.items} color={section.color} />
        </View>
      ))}
    </Page>
  ))
}

function CompetitorComparisonPages({ input }: { input: CommercialReportInput }) {
  const comparisons = competitorComparisons(input)
  const result = input.competitorCompare
  const target = input.client.ourBrand || (isPersonReport(input) ? "目标人物" : "我方品牌")
  return comparisons.map((comparison, comparisonIndex) => (
    <Page key={`${comparison.competitor}-${comparisonIndex}`} size="A4" style={styles.page} wrap>
      <HeaderFooter input={input} />
      <ChapterTitle
        kicker="COMPETITOR COMPARISON"
        title={`${target} vs ${comparison.competitor}`}
        intro={`第 ${comparisonIndex + 1}/${comparisons.length} 组对比，完整保留双方优势、短板、差异点、选择因素与内容动作。`}
      />
      {comparisonIndex === 0 && result?.ourWeaknessSummary?.length ? (
        <View style={styles.compactPanel} wrap={false}>
          <Text style={styles.compactPanelTitle}>我方共性短板</Text>
          <CompactList items={result.ourWeaknessSummary} color={COLORS.amber} />
        </View>
      ) : null}
      <View style={styles.insightBox} wrap={false}>
        <Text style={styles.insightTitle}>定位判断</Text>
        <Text style={styles.insightText}>{comparison.positioningSummary}</Text>
      </View>
      <View style={styles.twoColumn}>
        <View style={styles.halfColumn}>
          <View style={styles.compactPanel} wrap={false}><Text style={styles.compactPanelTitle}>{target}优势</Text><CompactList items={comparison.ourAdvantages} color={COLORS.green} /></View>
          <View style={styles.compactPanel} wrap={false}><Text style={styles.compactPanelTitle}>{target}短板</Text><CompactList items={comparison.ourWeaknesses} color={COLORS.amber} /></View>
        </View>
        <View style={styles.halfColumn}>
          <View style={styles.compactPanel} wrap={false}><Text style={styles.compactPanelTitle}>{comparison.competitor}优势</Text><CompactList items={comparison.competitorAdvantages} color={COLORS.red} /></View>
          <View style={styles.compactPanel} wrap={false}><Text style={styles.compactPanelTitle}>{comparison.competitor}短板</Text><CompactList items={comparison.competitorWeaknesses} color={COLORS.slate} /></View>
        </View>
      </View>
      <View style={styles.twoColumn}>
        <View style={styles.halfColumn}><View style={styles.compactPanel} wrap={false}><Text style={styles.compactPanelTitle}>核心差异点</Text><CompactList items={comparison.differentiators} color={COLORS.violet} /></View></View>
        <View style={styles.halfColumn}><View style={styles.compactPanel} wrap={false}><Text style={styles.compactPanelTitle}>用户选择因素</Text><CompactList items={comparison.userChoiceDrivers} color={COLORS.cyan} /></View></View>
      </View>
      <View style={styles.compactPanel} wrap={false}>
        <Text style={styles.compactPanelTitle}>建议内容动作</Text>
        <CompactList items={comparison.contentActions} color={COLORS.blue} />
      </View>
    </Page>
  ))
}

function coreAuditGroups(checks: GeoAuditCheck[]) {
  const definitions = [
    { title: "H1 / H2 标题", ids: ["title-h1", "heading-hierarchy"] },
    { title: "Q&A 问答", ids: ["visible-qa", "qa-schema"] },
    { title: "Robots 协议", ids: ["robots-generic", "robots-oai-search"] },
    { title: "LLMs 文本", ids: ["llms-txt"] },
  ]
  return definitions.map(definition => {
    const matched = checks.filter(check => definition.ids.includes(check.id))
    const status = matched.some(check => check.status === "fail")
      ? "fail" as const
      : matched.some(check => check.status === "warning")
        ? "warning" as const
        : matched.length > 0 && matched.every(check => check.status === "pass")
          ? "pass" as const
          : "not_applicable" as const
    return { ...definition, status, matched }
  })
}

function DiagnosisOverviewPage({ input }: { input: CommercialReportInput }) {
  const diagnosis = input.diagnosis!
  const audit = diagnosis.audit
  if (!audit) return <LegacyDiagnosisPage input={input} />
  const pass = audit.checks.filter(check => check.status === "pass").length
  const warning = audit.checks.filter(check => check.status === "warning").length
  const fail = audit.checks.filter(check => check.status === "fail").length
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle
        kicker="WEBSITE GEO AUDIT"
        title="AI 可检索性诊断"
        intro={`真实读取 ${audit.pagesFetched}/${audit.pagesRequested} 个计划页面，检查页面结构、爬虫协议、结构化数据、信任证据与 AI 可读性。`}
      />
      <View style={styles.penetrationHero} wrap={false}>
        <DonutChart value={audit.score / 100} display={`${audit.score}`} label="GEO 总分 / 100" color={COLORS.violet} />
        <View style={styles.heroMetrics}>
          <HeroMetric label="诊断可信度" value={audit.confidenceLabel} />
          <HeroMetric label="读取页面" value={`${audit.pagesFetched}/${audit.pagesRequested}`} />
          <HeroMetric label="未通过" value={`${fail} 项`} />
          <HeroMetric label="需优化" value={`${warning} 项`} />
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>六维 GEO 表现</Text>
        <View style={styles.visualPanel}><RadarScoreChart dimensions={audit.dimensions} /></View>
      </View>
      <View style={styles.statusStrip}>
        <View style={styles.statusCard}><Text style={styles.statusCardLabel}>已通过</Text><Text style={[styles.statusCardValue, { color: COLORS.green }]}>{pass}</Text></View>
        <View style={styles.statusCard}><Text style={styles.statusCardLabel}>需优化</Text><Text style={[styles.statusCardValue, { color: COLORS.amber }]}>{warning}</Text></View>
        <View style={styles.statusCard}><Text style={styles.statusCardLabel}>未通过</Text><Text style={[styles.statusCardValue, { color: COLORS.red }]}>{fail}</Text></View>
        <View style={styles.statusCard}><Text style={styles.statusCardLabel}>诊断耗时</Text><Text style={[styles.statusCardValue, { fontSize: 10 }]}>{(audit.durationMs / 1000).toFixed(1)} 秒</Text></View>
      </View>
      <View style={styles.twoColumn}>
        {coreAuditGroups(audit.checks).map(group => {
          const status = auditStatusMeta(group.status)
          return (
            <View key={group.title} style={styles.halfColumn}>
              <View style={styles.compactPanel} wrap={false}>
                <Text style={[styles.compactPanelTitle, { color: status.color }]}>{group.title} · {status.label}</Text>
                <Text style={styles.compactPanelText}>{group.matched.map(check => check.summary).join("；") || "本次未形成有效检查结果。"}</Text>
              </View>
            </View>
          )
        })}
      </View>
    </Page>
  )
}

function DiagnosisAccessPage({ input }: { input: CommercialReportInput }) {
  const audit = input.diagnosis!.audit!
  return (
    <Page size="A4" style={styles.page} wrap>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="ACCESS & RESOURCES" title="爬虫访问与关键资源" intro="分别呈现 AI 爬虫访问状态，以及 Robots、Sitemap、LLMs.txt 等关键资源的实际读取结果。" />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>AI 爬虫访问矩阵</Text>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <TableCell width="24%" header>爬虫</TableCell><TableCell width="18%" header>状态</TableCell><TableCell width="18%" header>是否显式</TableCell><TableCell width="40%" header>判断说明</TableCell>
          </View>
          {audit.botPolicies.map((policy, index) => (
            <View key={policy.key} style={[styles.tableRow, index === audit.botPolicies.length - 1 ? styles.tableLastRow : {}]} wrap={false}>
              <TableCell width="24%" strong>{policy.label}</TableCell><TableCell width="18%">{policy.status === "allowed" ? "允许" : policy.status === "blocked" ? "阻止" : "未知"}</TableCell><TableCell width="18%">{policy.explicit ? "是" : "否"}</TableCell><TableCell width="40%">{policy.note}</TableCell>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>关键资源状态</Text>
        {audit.resources.map(resource => (
          <View key={resource.kind} style={styles.sourceRow} wrap={false}>
            <Text style={styles.sourceTitle}>{resource.kind.toUpperCase()} · {resource.available && resource.valid ? "有效" : resource.available ? "可访问但需修复" : "未发现"}</Text>
            <Text style={styles.sourceMeta}>{resource.summary}{resource.error ? ` · ${resource.error}` : ""}</Text>
            <Link src={resource.url} style={styles.sourceLink}>{resource.url}</Link>
          </View>
        ))}
      </View>
      <View style={styles.insightBox} wrap={false}>
        <Text style={styles.insightTitle}>诊断结论</Text>
        <Text style={styles.insightText}>{audit.aiSummary.executiveSummary}</Text>
      </View>
      <View style={styles.twoColumn}>
        <View style={styles.halfColumn}><View style={styles.compactPanel} wrap={false}><Text style={styles.compactPanelTitle}>当前优势</Text><CompactList items={audit.aiSummary.strengths} color={COLORS.green} /></View></View>
        <View style={styles.halfColumn}><View style={styles.compactPanel} wrap={false}><Text style={styles.compactPanelTitle}>主要风险</Text><CompactList items={audit.aiSummary.risks} color={COLORS.red} /></View></View>
      </View>
      <View style={styles.compactPanel} wrap={false}><Text style={styles.compactPanelTitle}>优先整改动作</Text><CompactList items={audit.aiSummary.actions} color={COLORS.blue} /></View>
    </Page>
  )
}

function DiagnosisCheckPages({ input }: { input: CommercialReportInput }) {
  const checks = input.diagnosis!.audit!.checks
  const ordered = [...checks].sort((a, b) => ({ P0: 0, P1: 1, P2: 2 }[a.priority] - { P0: 0, P1: 1, P2: 2 }[b.priority]) || a.label.localeCompare(b.label))
  return chunk(ordered, 5).map((pageChecks, pageIndex) => (
    <Page key={`diagnosis-checks-${pageIndex}`} size="A4" style={styles.page} wrap>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="AUDIT EVIDENCE" title={pageIndex === 0 ? "检查明细、证据与建议" : "检查明细、证据与建议（续）"} intro="逐项保留状态、分值、证据、改进建议和对应页面网址。" />
      <Text style={styles.continuationLabel}>第 {pageIndex + 1} 组 · 共 {checks.length} 项检查</Text>
      {pageChecks.map(check => <AuditCheckCard key={check.id} check={check} />)}
    </Page>
  ))
}

function DiagnosisPageRecordPages({ input }: { input: CommercialReportInput }) {
  const pages = input.diagnosis!.audit!.pages
  return chunk(pages, 6).map((pageRows, pageIndex) => (
    <Page key={`diagnosis-pages-${pageIndex}`} size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="PAGE RECORDS" title={pageIndex === 0 ? "页面读取记录" : "页面读取记录（续）"} intro="保留本次诊断实际读取的页面、标题层级、问答、结构化数据、状态和耗时。" />
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <TableCell width="36%" header>页面</TableCell><TableCell width="10%" header>HTTP</TableCell><TableCell width="12%" header>H1/H2</TableCell><TableCell width="10%" header>问答</TableCell><TableCell width="22%" header>Schema</TableCell><TableCell width="10%" header>耗时</TableCell>
        </View>
        {pageRows.map((page, index) => (
          <View key={`${page.url}-${index}`} style={[styles.tableRow, index === pageRows.length - 1 ? styles.tableLastRow : {}]} wrap={false}>
            <View style={[styles.tableCell, { width: "36%" }]}><Link src={page.finalUrl} style={styles.sourceLink}>{page.title || page.finalUrl}</Link>{page.error ? <Text style={styles.auditCheckMeta}>{page.error}</Text> : null}</View>
            <TableCell width="10%">{page.status || "-"}</TableCell><TableCell width="12%">{page.h1.length}/{page.h2.length}</TableCell><TableCell width="10%">{page.visibleQuestionCount}</TableCell><TableCell width="22%">{page.structuredDataTypes.join("、") || "-"}</TableCell><TableCell width="10%">{page.loadTimeMs ? `${page.loadTimeMs}ms` : "-"}</TableCell>
          </View>
        ))}
      </View>
    </Page>
  ))
}

function LegacyDiagnosisPage({ input }: { input: CommercialReportInput }) {
  const diagnosis = input.diagnosis!
  const labels: Record<keyof typeof diagnosis.dimensions, string> = {
    authority: "权威性",
    structure: "结构清晰度",
    traceability: "信息可追溯",
    coverage: "内容覆盖",
    sentiment: "推荐友好度",
  }
  const dimensions = Object.entries(diagnosis.dimensions) as Array<[keyof typeof diagnosis.dimensions, number]>
  return (
    <Page size="A4" style={styles.page} wrap>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="LEGACY GEO DIAGNOSIS" title="AI 诊断 · 历史版本" intro="该结果沿用生成时保存的五维诊断口径，不用当前规则重新改写历史分数。" />
      <View style={styles.penetrationHero} wrap={false}>
        <DonutChart value={diagnosis.gemScore / 100} display={`${diagnosis.gemScore}`} label="GEO 总分 / 100" color={COLORS.violet} />
        <View style={styles.heroMetrics}>{dimensions.map(([key, value]) => <HeroMetric key={key} label={labels[key]} value={`${value} 分`} />)}</View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>各模型表现</Text>
        {Object.entries(diagnosis.modelDiagnosis).map(([model, item]) => (
          <View key={model} style={styles.auditCheck} wrap={false}>
            <Text style={styles.auditCheckTitle}>{MODEL_LABELS[model as ModelKey] || model}</Text>
            <Text style={styles.auditCheckMeta}>偏好：{item.preference}</Text>
            <Text style={styles.auditCheckMeta}>短板：{item.weakness}</Text>
            <Text style={styles.auditCheckMeta}>建议：{item.fix}</Text>
          </View>
        ))}
      </View>
    </Page>
  )
}

function DifficultyPage({ input }: { input: CommercialReportInput }) {
  const entry = input.difficulty!
  const result = entry.result
  const dimensions = Object.values(result.dimensions) as DifficultyDimensionResult[]
  const provider = entry.source || result.providerLabel || "在线智能测评"
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="DIFFICULTY ASSESSMENT" title="GEO 难度测评" intro={`${entry.city || "全国"} · ${entry.industry} · ${entry.mode === "brand" ? entry.targetBrand || "品牌评估" : "行业评估"}`} />
      <DifficultyDimensionsRing dimensions={dimensions} totalScore={result.totalScore} />
      <View style={styles.difficultyMetaGrid} wrap={false}>
        <DifficultyMeta label="难度等级" value={result.level} />
        <DifficultyMeta label="报告来源" value={provider} />
        <DifficultyMeta label="评估模式" value={entry.mode === "brand" ? "品牌评估" : "行业评估"} />
        <DifficultyMeta label="报告时间" value={formatDateToMinute(result.generatedAt)} />
      </View>
      <DetailMetric label="稳定提及周期" value={concisePeriod(result.stableMentionPeriod)} />
      <View style={styles.insightBox}>
        <Text style={styles.insightTitle}>测评结论</Text>
        <Text style={styles.insightText} orphans={2} widows={2}>{result.summary}</Text>
      </View>
    </Page>
  )
}

function DifficultyDetailsPage({ input }: { input: CommercialReportInput }) {
  const dimensions = Object.values(input.difficulty!.result.dimensions) as DifficultyDimensionResult[]
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="SCORE EXPLANATION" title={`${dimensions.length}维评分详解`} intro="完整呈现各维度分值、等级与判断依据，便于理解当前难点和优先投入方向。" />
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

function DifficultyCostPage({ input }: { input: CommercialReportInput }) {
  const estimate = input.difficulty!.result.costEstimate!
  return isContentVolumeCostEstimate(estimate)
    ? <DifficultyContentCostPage input={input} estimate={estimate} />
    : <DifficultyLegacyCostPage input={input} estimate={estimate} />
}

function DifficultyContentCostPage({
  input,
  estimate,
}: {
  input: CommercialReportInput
  estimate: DifficultyContentCostEstimate
}) {
  const v3 = isContentVolumeV3CostEstimate(estimate) ? estimate : null
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle
        kicker="CONTENT COST MODEL"
        title="GEO 执行成本测算"
        intro={v3
          ? `难度总分采用容易、中等、困难、超难四档工作量标准，分数越高，所需内容量逐步增加，跨档后会明显提升。行业与客单价共同调整执行标准；参考可靠度为${estimate.confidence}，三个阶段均为累计投入。`
          : `难度总分已包含地域、竞品、商业价值和资料缺口；预算按达到各阶段所需内容数量计算。参考可靠度为${estimate.confidence}，三个阶段均为累计投入。`}
      />
      <View style={styles.signalStrip} wrap={false}>
        {estimate.milestones.map(item => (
          <View key={item.key} style={styles.signalItem}>
            <Text style={styles.signalLabel}>{item.label}</Text>
            <Text style={styles.signalValue}>{formatMoneyRange(item.cumulativeCost)}</Text>
          </View>
        ))}
      </View>

      {v3 ? (
        <>
          <View style={[styles.section, { marginTop: 14 }]} wrap={false}>
            <Text style={styles.sectionTitle}>四档逐分推导</Text>
            <View style={styles.metricsGrid}>
              <MetricCard
                label="当前分数档"
                value={`${v3.difficultyBand.score}分 · ${v3.difficultyBand.level}`}
                note={`${v3.difficultyBand.minScore}-${v3.difficultyBand.maxScore}分，每分增长 ${(v3.difficultyBand.perPointGrowthRate * 100).toFixed(1)}%`}
              />
              <MetricCard
                label="稳定内容量"
                value={`${v3.difficultyBand.stableContent}条`}
                note={v3.difficultyBand.formula}
              />
              <MetricCard
                label="行业执行标准"
                value={v3.industryProfile.label}
                note={`${v3.industryProfile.source === "manual" ? "用户选择" : "系统判断"}：${v3.industryProfile.reason}`}
              />
              <MetricCard
                label="综合执行系数"
                value={`${v3.industryProfile.effectiveMultiplier}倍`}
                note={`行业 ${v3.industryProfile.riskMultiplier}倍 · 客单价 ${v3.industryProfile.valueMultiplier}倍`}
              />
            </View>
          </View>
          <View style={styles.insightBox} wrap={false}>
            <Text style={styles.insightTitle}>下一分与下一档影响</Text>
            <Text style={styles.insightText}>
              {v3.difficultyBand.nextScoreImpact
                ? `${v3.difficultyBand.score}→${v3.difficultyBand.nextScoreImpact.toScore}分：增加 ${v3.difficultyBand.nextScoreImpact.contentDelta} 条内容，稳定成本增加 ${formatMoney(v3.difficultyBand.nextScoreImpact.costDelta)}。`
                : "当前已到 100 分，采用最高工作量标准。"}
            </Text>
            <Text style={styles.insightText}>
              {v3.difficultyBand.nextLevelTransition
                ? `${v3.difficultyBand.nextLevelTransition.fromScore}→${v3.difficultyBand.nextLevelTransition.toScore}分跨档：内容量从 ${v3.difficultyBand.nextLevelTransition.fromContent} 条跃升至 ${v3.difficultyBand.nextLevelTransition.toContent} 条，成本增加 ${formatMoney(v3.difficultyBand.nextLevelTransition.costDelta)}。`
                : "当前为超难档，不再设置更高等级。"}
            </Text>
          </View>
        </>
      ) : null}

      <View style={[styles.table, { marginTop: 16 }]}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <TableCell width="20%" header>目标阶段</TableCell>
          <TableCell width="12%" header>周期</TableCell>
          <TableCell width="14%" header>内容量</TableCell>
          <TableCell width="13%" header>建议自媒体</TableCell>
          <TableCell width="13%" header>建议权威</TableCell>
          <TableCell width="12%" header>建议视频</TableCell>
          <TableCell width="16%" header>累计成本</TableCell>
        </View>
        {estimate.milestones.map((item, index) => (
          <View key={item.key} style={[styles.tableRow, index === estimate.milestones.length - 1 ? styles.tableLastRow : {}]} wrap={false}>
            <TableCell width="20%" strong>{item.label}</TableCell>
            <TableCell width="12%">{item.days.min}-{item.days.max}天</TableCell>
            <TableCell width="14%">{item.contentCount.min}-{item.contentCount.max}条</TableCell>
            <TableCell width="13%">{item.allocation.selfMediaArticles}篇</TableCell>
            <TableCell width="13%">{item.allocation.authorityMediaArticles}篇</TableCell>
            <TableCell width="12%">{item.allocation.douyinVideos}个</TableCell>
            <TableCell width="16%" strong>{formatMoneyRange(item.cumulativeCost)}</TableCell>
          </View>
        ))}
      </View>

      <View style={[styles.section, { marginTop: 16 }]} wrap={false}>
        <Text style={styles.sectionTitle}>{v3 ? "执行结构与成本基准" : "固定测算基准"}</Text>
        {v3 ? (
          <View style={styles.metricsGrid}>
            <MetricCard label="基础建设" value={formatMoney(v3.foundationCost)} note="官网和第三方站，只计一次" />
            <MetricCard label="信任与合规准备" value={formatMoney(v3.riskPreparationCost)} note={`调整后基础投入 ${formatMoney(v3.effectiveFoundationCost)}`} />
            <MetricCard label="当前综合单价" value={`¥${v3.effectiveWeightedUnitCost.toFixed(2)}/条`} note={`基准 ¥${v3.baselineWeightedUnitCost.toFixed(1)}/条`} />
            <MetricCard label="内容结构" value={`${Math.round(v3.contentRatios.selfMediaArticles * 100)}/${Math.round(v3.contentRatios.authorityMediaArticles * 100)}/${Math.round(v3.contentRatios.douyinVideos * 100)}`} note="自媒体 / 权威媒体 / 视频" />
          </View>
        ) : (
          <View style={styles.metricsGrid}>
            <MetricCard label="基础建设" value={formatMoney(estimate.foundationCost)} />
            <MetricCard label="自媒体文章" value={`${Math.round(estimate.contentRatios.selfMediaArticles * 100)}% · ¥${estimate.unitCosts.selfMediaArticle}/篇`} />
            <MetricCard label="权威媒体" value={`${Math.round(estimate.contentRatios.authorityMediaArticles * 100)}% · ¥${estimate.unitCosts.authorityMediaArticle}/篇`} />
            <MetricCard label="抖音视频" value={`${Math.round(estimate.contentRatios.douyinVideos * 100)}% · ¥${estimate.unitCosts.douyinVideo}/个`} />
          </View>
        )}
      </View>

      <View style={[styles.insightBox, { marginTop: 14 }]} wrap={false}>
        <Text style={styles.insightTitle}>阶段验收与测算前提</Text>
        {estimate.milestones.map((item, index) => (
          <Text key={item.key} style={styles.insightText}>{index + 1}. {item.label}：{item.successDefinition}。</Text>
        ))}
        {estimate.assumptions.map((item, index) => (
          <Text key={`${index}-${item}`} style={styles.insightText}>{index + 4}. {item}</Text>
        ))}
      </View>
    </Page>
  )
}

function DifficultyLegacyCostPage({
  input,
  estimate,
}: {
  input: CommercialReportInput
  estimate: DifficultyLegacyCostEstimate
}) {
  const lineItems = [
    ["一次性基础建设", estimate.oneTimeFoundation, "信息架构、基础页面、测评基线与内容规划"],
    ["每月内容生产", estimate.monthlyContent, "文章、问答、案例、对比和场景内容"],
    ["权威信源资产", estimate.authorityAssets, "资质、案例、媒体与第三方验证资产"],
    ["地域覆盖建设", estimate.regionalCoverage, "区域页面、本地案例、地图与地方信源"],
    ["每月监测复盘", estimate.monthlyMonitoring, "定期检测品牌提及、来源变化与策略效果"],
  ] as const
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle
        kicker="BUDGET ESTIMATE"
        title="GEO 执行成本测算 · 历史版本"
        intro={`此报告按生成时的测算标准，结合${input.difficulty!.city || "全国"}覆盖范围和竞争强度估算。重新测评后会按当前内容数量和单价标准计算。`}
      />
      <View style={styles.signalStrip} wrap={false}>
        <View style={styles.signalItem}>
          <Text style={styles.signalLabel}>30 天验证期</Text>
          <Text style={styles.signalValue}>{formatMoneyRange(estimate.validation30Days)}</Text>
        </View>
        <View style={styles.signalItem}>
          <Text style={styles.signalLabel}>90 天稳定期</Text>
          <Text style={styles.signalValue}>{formatMoneyRange(estimate.stabilization90Days)}</Text>
        </View>
        <View style={styles.signalItem}>
          <Text style={styles.signalLabel}>180 天规模期</Text>
          <Text style={styles.signalValue}>{formatMoneyRange(estimate.scale180Days)}</Text>
        </View>
      </View>
      <View style={[styles.table, { marginTop: 16 }]}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <TableCell width="24%" header>预算项目</TableCell>
          <TableCell width="22%" header>估算区间</TableCell>
          <TableCell width="54%" header>包含内容</TableCell>
        </View>
        {lineItems.map(([label, range, note], index) => (
          <View key={label} style={[styles.tableRow, index === lineItems.length - 1 ? styles.tableLastRow : {}]} wrap={false}>
            <TableCell width="24%" strong>{label}</TableCell>
            <TableCell width="22%" strong>{formatMoneyRange(range)}</TableCell>
            <TableCell width="54%">{note}</TableCell>
          </View>
        ))}
      </View>
      <View style={[styles.section, { marginTop: 16 }]} wrap={false}>
        <Text style={styles.sectionTitle}>建议工作量</Text>
        <View style={styles.metricsGrid}>
          <MetricCard label="每月内容" value={`${estimate.workload.articlesPerMonth} 篇`} />
          <MetricCard label="权威资产" value={`${estimate.workload.authorityAssets} 项`} />
          <MetricCard label="渠道覆盖" value={`${estimate.workload.channelCount} 个`} />
          <MetricCard label="区域页面" value={`${estimate.workload.regionalPages} 个`} />
        </View>
      </View>
      <View style={styles.insightBox} wrap={false}>
        <Text style={styles.insightTitle}>测算前提</Text>
        {estimate.assumptions.map((item, index) => (
          <Text key={`${index}-${item}`} style={styles.insightText}>{index + 1}. {item}</Text>
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
  const terms = reportVocabulary(input)
  const methodology = [
    input.penetration
      ? "渗透率来自所选模型对真实疑问句的独立联网回答；同义问题在汇总时归类，避免重复样本放大结果。"
      : "",
    input.penetration
      ? isPersonReport(input)
        ? "人物识别与同行判定在回答生成后完成，不把目标人物、同行名单或身份资料注入被测问题。"
        : "品牌识别在回答生成后完成，不把目标品牌和优势信息注入被测问题。"
      : "",
    input.research || input.competitorCompare
      ? "独立调研与竞品对比使用生成时已经保存的结论、评分和证据，导出过程不重新调用模型。"
      : "",
    input.diagnosis
      ? "AI 诊断分数来自实际页面读取、爬虫协议和结构化证据；AI 只负责解释，不能修改确定性评分。"
      : "",
    input.difficulty
      ? "难度评分、周期和成本结论均采用测评时保存的版本，不按当前规则回写历史结果。"
      : "",
    "本报告用于 GEO 策略与内容决策，不构成法律、财务或绝对排名承诺。",
  ].filter(Boolean)
  return (
    <Page size="A4" style={styles.page}>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="ACTION ROADMAP" title="行动路线与方法说明" intro={`把报告结论转化为可执行的内容、信源和${terms.assets}建设任务。`} />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>建议优先级</Text>
        <NumberedList items={actionItems(input)} />
      </View>
      <View style={styles.methodology}>
        <Text>方法说明</Text>
        {methodology.map((item, index) => <Text key={item} style={index === 0 ? { marginTop: 5 } : undefined}>{index + 1}. {item}</Text>)}
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
      <ChapterTitle kicker="ASSESSMENT BASIS" title="测评依据" intro="展示每一步使用的资料和结论依据，便于理解最终结果。" />
      {stages.map((stage, index) => (
        <View key={`${stage.title}-${index}`} style={styles.appendixItem} wrap={false}>
          <Text style={styles.appendixMeta}>{index + 1}. {stage.title}</Text>
          <Text style={styles.appendixAnswer}>{stage.summary}</Text>
          {stage.evidence.length > 0 ? (
            <Text style={styles.sourceMeta}>依据：{stage.evidence.join("；")}</Text>
          ) : null}
          <View style={styles.pillRow}>{stage.tags.map(tag => <Text key={tag} style={styles.pill}>{tag}</Text>)}</View>
        </View>
      ))}
    </Page>
  )
}

function AppendixPages({ input, answers }: { input: CommercialReportInput; answers: FlattenedAnswer[] }) {
  if (input.detail !== "full" || answers.length === 0) return null
  return (
    <Page size="A4" style={styles.page} wrap>
      <HeaderFooter input={input} />
      <ChapterTitle kicker="APPENDIX" title="原始联网回答与来源" intro={`按模型完整列出 ${answers.length} 条已保存回答及其来源，不在报告生成时重新提问。`} />
      {answers.map(({ model, item }, index) => (
        <View key={`${model}-${index}-${item.question}`} style={styles.appendixItem}>
          <Text style={styles.appendixMeta}>{MODEL_LABELS[model]} · Q{index + 1} · {item.webVerified ? "联网可验证" : "联网未验证"}</Text>
          <Text style={styles.appendixQuestion}>{item.question}</Text>
          <Text style={styles.appendixAnswer}>{item.answer || item.webFailureReason || "该回答未返回有效内容。"}</Text>
          {item.mentionedBrands.length > 0 ? (
            <View style={styles.pillRow}>{item.mentionedBrands.map(brand => <Text key={brand} style={styles.pill}>{brand}</Text>)}</View>
          ) : null}
        </View>
      ))}
    </Page>
  )
}

function ClosingPage({ input }: { input: CommercialReportInput }) {
  const branding = brandingForInput(input)
  return (
    <Page size="A4" style={styles.cover} wrap={false}>
      {/* react-pdf Image is not a DOM img and has no alt prop. */}
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <Image src={COVER_BACKGROUND_PATH} style={styles.coverBackground} />
      <View style={styles.coverShade} />
      <View style={styles.closingContent}>
        <PublisherLockup branding={branding} />
        <View>
          <Text style={styles.closingTitle}>
            {isPersonReport(input)
              ? "以真实回答为起点，持续校准个人 IP 在 AI 搜索中的专业位置。"
              : "以真实回答为起点，持续校准品牌在 AI 中的位置。"}
          </Text>
          <Text style={styles.closingText}>
            {isPersonReport(input)
              ? "本报告反映生成时点的模型回答、联网信源和人物识别证据，不代表对个人专业能力的绝对评价。建议在关键专业内容与公开信源上线后定期复测。"
              : "本报告反映生成时点的模型回答、联网信源和评分证据。建议在关键内容、信源和品牌动作上线后定期复测。"}
          </Text>
          {branding.website ? <Link src={branding.website} style={styles.closingWebsite}>{displayWebsite(branding.website)}</Link> : null}
        </View>
        <Text style={styles.closingFooter}>CONFIDENTIAL · {reportId(input)}</Text>
      </View>
    </Page>
  )
}

export function CommercialReportDocument({ input }: { input: CommercialReportInput }) {
  const answers = flattenAnswers(input)
  const sources = uniqueSources(answers)
  const branding = brandingForInput(input)
  return (
    <Document title={`${input.client.name} GEO 商业报告`} author={branding.companyName} subject="GEO 商业洞察报告" language="zh-CN">
      <CoverPage input={input} />
      <SummaryPage input={input} answers={answers} sources={sources} />
      {input.penetration ? <PenetrationPage input={input} answers={answers} /> : null}
      {input.penetration ? <PenetrationTablesPage input={input} /> : null}
      {input.penetration ? <QuestionCoveragePages input={input} answers={answers} /> : null}
      {input.penetration ? <PenetrationOpportunityPage input={input} /> : null}
      {input.penetration ? <SourcesPage input={input} answers={answers} sources={sources} /> : null}
      {input.penetration ? <SourceIndexPages input={input} sources={sources} /> : null}
      {input.research ? <ResearchOverviewPage input={input} /> : null}
      {input.research ? <ResearchDimensionEvidencePages input={input} /> : null}
      {input.research ? <ResearchFindingsPages input={input} /> : null}
      {input.competitorCompare ? <CompetitorComparisonPages input={input} /> : null}
      {input.diagnosis ? <DiagnosisOverviewPage input={input} /> : null}
      {input.diagnosis?.audit ? <DiagnosisAccessPage input={input} /> : null}
      {input.diagnosis?.audit ? <DiagnosisCheckPages input={input} /> : null}
      {input.diagnosis?.audit ? <DiagnosisPageRecordPages input={input} /> : null}
      {input.difficulty ? <DifficultyPage input={input} /> : null}
      {input.difficulty ? <DifficultyDetailsPage input={input} /> : null}
      {input.difficulty?.result.costEstimate ? <DifficultyCostPage input={input} /> : null}
      {input.difficulty ? <DifficultyInsightsPages input={input} /> : null}
      <ActionPage input={input} />
      <ProcessEvidencePage input={input} />
      <AppendixPages input={input} answers={answers} />
      <ClosingPage input={input} />
    </Document>
  )
}
