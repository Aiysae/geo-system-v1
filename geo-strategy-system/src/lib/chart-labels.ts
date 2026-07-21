const WIDE_GRAPHEME = /[\u2e80-\u9fff\uf900-\ufaff\uff01-\uff60\uffe0-\uffe6]/

function displayUnits(value: string): number {
  return WIDE_GRAPHEME.test(value) || value.codePointAt(0)! > 0xff ? 2 : 1
}

function textDisplayUnits(value: string): number {
  return Array.from(value).reduce((total, grapheme) => total + displayUnits(grapheme), 0)
}

function wrapContinuousText(text: string, maxUnits: number): string[] {
  const lines: string[] = []
  let line = ""
  let units = 0

  for (const grapheme of Array.from(text)) {
    const nextUnits = displayUnits(grapheme)
    if (line && units + nextUnits > maxUnits) {
      lines.push(line)
      line = grapheme
      units = nextUnits
    } else {
      line += grapheme
      units += nextUnits
    }
  }
  if (line) lines.push(line)
  return lines
}

/** Wraps a label without dropping any characters. The limit uses visual units:
 * CJK and other wide glyphs count as two, while Latin glyphs count as one. */
export function wrapChartLabel(value: unknown, maxUnits = 18): string[] {
  const text = String(value ?? "").trim()
  if (!text) return [""]

  const safeLimit = Math.max(4, Math.floor(maxUnits))
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 1) return wrapContinuousText(text, safeLimit)

  const lines: string[] = []
  let line = ""

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (textDisplayUnits(candidate) <= safeLimit) {
      line = candidate
      continue
    }
    if (line) {
      lines.push(line)
      line = ""
    }
    if (textDisplayUnits(word) <= safeLimit) {
      line = word
      continue
    }
    const chunks = wrapContinuousText(word, safeLimit)
    lines.push(...chunks.slice(0, -1))
    line = chunks.at(-1) || ""
  }
  if (line) lines.push(line)
  return lines
}
