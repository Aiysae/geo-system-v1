import { NextRequest, NextResponse } from "next/server"
import {
  buildMaterialTemplateDocx,
  materialTemplateFileName,
  type MaterialTemplateSubjectType,
} from "@/lib/geo-strategy/material-template"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function disposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(
    /[!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="geo-material-template.docx"; filename*=UTF-8''${encoded}`
}

export async function GET(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  const subjectType: MaterialTemplateSubjectType = request.nextUrl.searchParams.get("subjectType") === "person"
    ? "person"
    : "brand"
  const buffer = await buildMaterialTemplateDocx(subjectType)
  const fileName = materialTemplateFileName(subjectType)
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": disposition(fileName),
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
