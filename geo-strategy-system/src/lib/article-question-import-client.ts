"use client"

import {
  MAX_ARTICLE_QUESTION_IMPORT_FILE_BYTES,
  parseArticleQuestionMatrix,
  type ArticleQuestionImportPreview,
} from "@/lib/article-question-import"

export const ARTICLE_QUESTION_TEMPLATE_URL = "/templates/shitu-geo-article-question-import-template.xlsx"

function fileExtension(file: File): string {
  const match = /\.([^.]+)$/.exec(file.name.toLocaleLowerCase("zh-CN"))
  return match?.[1] || ""
}

export async function parseArticleQuestionFile(
  file: File,
): Promise<ArticleQuestionImportPreview> {
  if (file.size > MAX_ARTICLE_QUESTION_IMPORT_FILE_BYTES) {
    throw new Error("文件不能超过 5MB，请拆分后再导入")
  }
  const extension = fileExtension(file)
  if (extension === "xls") {
    throw new Error("暂不支持旧版 .xls，请另存为 .xlsx 后再导入")
  }
  if (extension !== "xlsx" && extension !== "csv") {
    throw new Error("请选择 .xlsx 或 .csv 文件")
  }

  if (extension === "csv") {
    const [{ default: Papa }, content] = await Promise.all([
      import("papaparse"),
      file.text(),
    ])
    const parsed = Papa.parse<unknown[]>(content.replace(/^\uFEFF/, ""), {
      skipEmptyLines: false,
    })
    if (parsed.errors.length > 0) {
      const first = parsed.errors[0]
      throw new Error(`CSV 第 ${Number(first.row ?? 0) + 1} 行格式有误：${first.message}`)
    }
    return parseArticleQuestionMatrix(parsed.data)
  }

  const { default: readXlsxFile } = await import("read-excel-file/browser")
  const sheets = await readXlsxFile(file)
  const templateSheet = sheets.find(sheet => sheet.sheet.trim() === "疑问句与优势")
  if (templateSheet) {
    return parseArticleQuestionMatrix(templateSheet.data, {
      sheetName: templateSheet.sheet,
    })
  }
  let lastError: Error | null = null
  for (const sheet of sheets) {
    try {
      return parseArticleQuestionMatrix(sheet.data, { sheetName: sheet.sheet })
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw lastError || new Error("Excel 表格没有可导入的数据")
}
