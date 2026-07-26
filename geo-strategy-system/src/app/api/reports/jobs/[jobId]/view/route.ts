import { NextRequest, NextResponse } from "next/server"
import { createReadStream } from "node:fs"
import { Readable } from "node:stream"
import { getCommercialReportFileMetadata } from "@/lib/reports/report-jobs"
import {
  isReportAccessError,
  requireReportJobAccess,
} from "@/lib/reports/access"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  try {
    const { jobId } = await context.params
    const authorized = await requireReportJobAccess({
      jobId,
      userId: userGuard.userId,
      action: "view",
    })
    if (!authorized) {
      return NextResponse.json({ error: "报告尚未生成、已过期或无权访问" }, { status: 404 })
    }
    const report = await getCommercialReportFileMetadata(jobId, authorized.scope.ownerUserId)
    if (!report) {
      return NextResponse.json({ error: "报告尚未生成、已过期或无权访问" }, { status: 404 })
    }

    const encodedName = encodeURIComponent(report.fileName).replace(
      /[!'()*]/g,
      character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    const range = parseByteRange(request.headers.get("range"), report.fileSize)
    if (range === "invalid") {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${report.fileSize}` },
      })
    }
    const start = range?.start ?? 0
    const end = range?.end ?? report.fileSize - 1
    const stream = Readable.toWeb(createReadStream(report.filePath, { start, end }))
    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Content-Length": String(end - start + 1),
      "Content-Disposition": `inline; filename="geo-report.pdf"; filename*=UTF-8''${encodedName}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    }
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${report.fileSize}`
    return new NextResponse(stream as ReadableStream<Uint8Array>, {
      status: range ? 206 : 200,
      headers,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "预览报告失败" },
      { status: isReportAccessError(error) ? 403 : 500 },
    )
  }
}

function parseByteRange(
  value: string | null,
  fileSize: number,
): { start: number; end: number } | "invalid" | null {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match) return "invalid"
  const rawStart = match[1]
  const rawEnd = match[2]
  if (!rawStart && !rawEnd) return "invalid"

  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return "invalid"
    return {
      start: Math.max(0, fileSize - suffixLength),
      end: fileSize - 1,
    }
  }

  const start = Number(rawStart)
  const end = rawEnd ? Number(rawEnd) : fileSize - 1
  if (
    !Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || start >= fileSize
    || end < start
  ) return "invalid"
  return { start, end: Math.min(end, fileSize - 1) }
}
