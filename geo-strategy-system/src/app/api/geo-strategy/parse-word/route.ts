import { NextRequest, NextResponse } from "next/server"
import WordExtractor from "word-extractor"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

const MAX_WORD_FILE_SIZE = 15 * 1024 * 1024
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

function hasSignature(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b
}

function cleanWordText(value: string): string {
  return value
    .replace(/\u0007/g, "\t")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
}

function friendlyParseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "")
  if (/password|encrypt/i.test(message)) {
    return "Word 文档已加密或设有打开密码，请取消密码后重新上传。"
  }
  if (/central directory|zipfile|invalid zip|end of data/i.test(message)) {
    return "Word 文档结构已损坏，或文件后缀与实际格式不一致。请用 Word/WPS 打开后另存为新的 .docx 文件。"
  }
  if (/unable to read this type of file/i.test(message)) {
    return "这不是系统可识别的 Word 文档，请用 Word/WPS 另存为 .docx 后重新上传。"
  }
  return "Word 文档解析失败，请用 Word/WPS 打开后另存为新的 .docx 文件再上传。"
}

export async function POST(req: NextRequest) {
  const guard = await requireUserId()
  if (!guard.ok) return guard.response

  try {
    const formData = await req.formData()
    const file = formData.get("file")

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择要解析的 Word 文档" }, { status: 400 })
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "Word 文档为空，请重新选择文件" }, { status: 400 })
    }
    if (file.size > MAX_WORD_FILE_SIZE) {
      return NextResponse.json({ error: "Word 文档不能超过 15MB" }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, Math.min(buffer.byteLength, 8))
    if (!hasSignature(bytes, OLE_SIGNATURE) && !isZip(bytes)) {
      return NextResponse.json(
        { error: "文件后缀虽然是 Word，但实际内容不是有效的 .doc 或 .docx 文档" },
        { status: 422 }
      )
    }

    const extractor = new WordExtractor()
    const document = await extractor.extract(buffer)
    const content = cleanWordText(document.getBody())

    if (!content) {
      return NextResponse.json(
        { error: "Word 文档没有可提取的文字；如果内容是扫描图片，请改为上传 PDF 或图片" },
        { status: 422 }
      )
    }

    return NextResponse.json({
      content,
      format: hasSignature(bytes, OLE_SIGNATURE) ? "doc" : "docx",
    })
  } catch (error) {
    console.error("[parse-word]", error)
    return NextResponse.json({ error: friendlyParseError(error) }, { status: 422 })
  }
}
