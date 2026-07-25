import { readFile } from "node:fs/promises"
import JSZip from "jszip"
import { JSDOM } from "jsdom"

function xmlDocument(value: string): Document {
  return new JSDOM(value, { contentType: "text/xml" }).window.document
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A"
  let value = 0
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64
  return Math.max(0, value - 1)
}

function textContent(node: Element): string {
  return Array.from(node.querySelectorAll("t"))
    .map(item => item.textContent || "")
    .join("")
}

export async function readFirstXlsxWorksheet(filePath: string): Promise<string[][]> {
  const zip = await JSZip.loadAsync(await readFile(filePath))
  const sharedStringsFile = zip.file("xl/sharedStrings.xml")
  const sheetFile = zip.file("xl/worksheets/sheet1.xml")
  if (!sheetFile) throw new Error("Excel 文件缺少首个工作表")

  const sharedStrings = sharedStringsFile
    ? Array.from(
        xmlDocument(await sharedStringsFile.async("string")).querySelectorAll("si"),
      ).map(textContent)
    : []
  const sheet = xmlDocument(await sheetFile.async("string"))
  const rows: string[][] = []

  for (const rowNode of Array.from(sheet.querySelectorAll("sheetData > row"))) {
    const rowNumber = Math.max(1, Number(rowNode.getAttribute("r")) || rows.length + 1)
    const row: string[] = []
    for (const cellNode of Array.from(rowNode.querySelectorAll(":scope > c"))) {
      const index = columnIndex(cellNode.getAttribute("r") || "A")
      const type = cellNode.getAttribute("t")
      const raw = cellNode.querySelector(":scope > v")?.textContent || ""
      if (type === "s") row[index] = sharedStrings[Number(raw)] || ""
      else if (type === "inlineStr") row[index] = textContent(cellNode)
      else row[index] = raw
    }
    rows[rowNumber - 1] = row
  }

  return rows
}
