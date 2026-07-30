import type {
  ArticleQuestionMaterialInput,
  ArticleQuestionMaterialSkippedRow,
} from "@/types"

export const MAX_ARTICLE_QUESTION_IMPORT_ROWS = 1_000
export const MAX_ARTICLE_QUESTION_IMPORT_FILE_BYTES = 5 * 1024 * 1024

export const ARTICLE_QUESTION_TEMPLATE_HEADERS = [
  "序号",
  "对应核心关键词",
  "七类主意图",
  "决策维度",
  "用户高频问题",
  "内容方向建议",
  "GEO收录优化要点",
  "匹配优势",
] as const

export type ArticleQuestionImportPreview = {
  rows: ArticleQuestionMaterialInput[]
  skipped: ArticleQuestionMaterialSkippedRow[]
  totalDataRows: number
  warningCount: number
  sheetName?: string
}

type FieldKey = Exclude<keyof ArticleQuestionMaterialInput, "rowNumber">

const HEADER_ALIASES: Record<FieldKey, readonly string[]> = {
  question: [
    "用户高频问题",
    "用戶高頻問題",
    "疑问句",
    "疑問句",
    "疑问句（香港用语）",
    "疑問句（香港用語）",
    "问题",
    "問題",
    "核心问题",
    "核心問題",
    "搜索问题",
    "搜尋問題",
    "用户问题",
    "用戶問題",
  ],
  matchedAdvantage: [
    "匹配优势",
    "匹配優勢",
    "对应优势",
    "對應優勢",
    "配对优势",
    "配對優勢",
    "配对优势（来源：第二份文件）",
    "配對優勢（來源：第二份文件）",
    "主要优势",
    "主要優勢",
    "核心优势",
    "核心優勢",
    "优势",
    "優勢",
  ],
  keyword: [
    "对应核心关键词",
    "核心关键词",
    "关键词",
  ],
  category: [
    "七类主意图",
    "问题类别",
    "意图类别",
    "类别",
  ],
  intent: [
    "用户意图",
    "问题意图",
    "搜索意图",
  ],
  decisionDimension: [
    "决策维度",
    "判断维度",
  ],
  contentAngle: [
    "内容方向建议",
    "内容方向",
    "内容切入",
    "内容角度",
  ],
  geoOptimizationText: [
    "GEO收录优化要点",
    "GEO优化要点",
    "收录优化要点",
    "优化要点",
  ],
}

const FIELD_LIMITS: Record<FieldKey, number> = {
  question: 500,
  matchedAdvantage: 3_000,
  keyword: 200,
  category: 120,
  intent: 300,
  decisionDimension: 200,
  contentAngle: 500,
  geoOptimizationText: 2_000,
}

function cellText(value: unknown, max = 3_000): string {
  if (value == null) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).replace(/\u0000/g, "").trim().slice(0, max)
}

function normalizeHeader(value: unknown): string {
  return cellText(value, 160)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s_\-—–:：()（）[\]【】]/g, "")
    .replace(/必填|选填|建议填写|推荐填写/g, "")
}

function aliasMatch(header: string, alias: string): boolean {
  const normalizedAlias = normalizeHeader(alias)
  return header === normalizedAlias
}

function headerColumns(row: unknown[]): Partial<Record<FieldKey, number>> {
  const columns: Partial<Record<FieldKey, number>> = {}
  const headers = row.map(normalizeHeader)
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [FieldKey, readonly string[]]
  >) {
    const index = headers.findIndex(header => (
      header && aliases.some(alias => aliasMatch(header, alias))
    ))
    if (index >= 0) columns[field] = index
  }
  return columns
}

function questionColumn(columns: Partial<Record<FieldKey, number>>): number | undefined {
  return columns.question
}

export function normalizeArticleQuestionKey(value: unknown): string {
  return cellText(value, 500)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\u3000，。！？、；：,.!?;:'"“”‘’（）()【】[\]《》<>·•—–_-]+/g, "")
}

export function parseArticleQuestionMatrix(
  matrix: unknown[][],
  options: { sheetName?: string } = {},
): ArticleQuestionImportPreview {
  const nonEmpty = matrix
    .slice(0, MAX_ARTICLE_QUESTION_IMPORT_ROWS + 30)
    .map((row, index) => ({ row, index }))
    .filter(item => item.row.some(value => Boolean(cellText(value))))
  const headerCandidate = nonEmpty
    .filter(item => item.index < 20)
    .map(item => ({ ...item, columns: headerColumns(item.row) }))
    .find(item => questionColumn(item.columns) !== undefined)

  if (!headerCandidate) {
    throw new Error("没有找到“用户高频问题”或“疑问句”列，请使用系统模板后重试")
  }

  const dataRows = matrix.slice(headerCandidate.index + 1)
    .map((row, index) => ({
      row,
      rowNumber: headerCandidate.index + index + 2,
    }))
    .filter(item => item.row.some(value => Boolean(cellText(value))))

  if (dataRows.length === 0) throw new Error("Excel 表格没有可导入的疑问句")
  if (dataRows.length > MAX_ARTICLE_QUESTION_IMPORT_ROWS) {
    throw new Error(`单次最多导入 ${MAX_ARTICLE_QUESTION_IMPORT_ROWS} 行，请拆分文件后重试`)
  }

  const rows: ArticleQuestionMaterialInput[] = []
  const skipped: ArticleQuestionMaterialSkippedRow[] = []
  const seen = new Map<string, number>()
  let warningCount = 0

  for (const item of dataRows) {
    const valueFor = (field: FieldKey): string => {
      const column = headerCandidate.columns[field]
      return column === undefined ? "" : cellText(item.row[column], FIELD_LIMITS[field])
    }
    const question = valueFor("question")
    if (!question) {
      skipped.push({
        rowNumber: item.rowNumber,
        question: "",
        reason: "invalid",
        message: "疑问句为空",
      })
      continue
    }
    const key = normalizeArticleQuestionKey(question)
    if (!key) {
      skipped.push({
        rowNumber: item.rowNumber,
        question,
        reason: "invalid",
        message: "疑问句没有有效文字",
      })
      continue
    }
    const duplicateRow = seen.get(key)
    if (duplicateRow) {
      skipped.push({
        rowNumber: item.rowNumber,
        question,
        reason: "duplicate_batch",
        message: `与第 ${duplicateRow} 行疑问句重复`,
      })
      continue
    }
    seen.set(key, item.rowNumber)

    const matchedAdvantage = valueFor("matchedAdvantage")
    if (!matchedAdvantage) warningCount += 1
    const category = valueFor("category")
    rows.push({
      rowNumber: item.rowNumber,
      question,
      matchedAdvantage: matchedAdvantage || undefined,
      keyword: valueFor("keyword") || undefined,
      category: category || undefined,
      intent: valueFor("intent") || category || undefined,
      decisionDimension: valueFor("decisionDimension") || undefined,
      contentAngle: valueFor("contentAngle") || undefined,
      geoOptimizationText: valueFor("geoOptimizationText") || undefined,
    })
  }

  if (rows.length === 0) {
    throw new Error("没有找到可导入的有效疑问句，请检查表格内容")
  }

  return {
    rows,
    skipped,
    totalDataRows: dataRows.length,
    warningCount,
    sheetName: options.sheetName,
  }
}
