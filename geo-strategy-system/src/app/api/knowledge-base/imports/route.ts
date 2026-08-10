import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createBackgroundJob } from "@/lib/background-jobs"
import {
  isKnowledgeImportAccessError,
  requireKnowledgeImportAccess,
} from "@/lib/knowledge-import/access"
import {
  KNOWLEDGE_IMPORT_MAX_TOTAL_BYTES,
  parseKnowledgeImportFile,
  validateKnowledgeImportFiles,
} from "@/lib/knowledge-import/parser"
import {
  createKnowledgeImportRecord,
  findKnowledgeImportByRequest,
  getPublicWorkspaceKnowledgeImport,
  listWorkspaceKnowledgeImports,
  patchKnowledgeImportRecord,
} from "@/lib/knowledge-import/store"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

const MAX_REQUEST_BYTES = KNOWLEDGE_IMPORT_MAX_TOTAL_BYTES + 2 * 1024 * 1024
const MAX_BACKGROUND_PAYLOAD_BYTES = 21 * 1024 * 1024

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  return response
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "资料导入失败"
  const status = isKnowledgeImportAccessError(error)
    ? 403
    : /(请选择|缺失|无效|不支持|超过|空文件|没有可提取|扫描件|最多)/.test(message)
      ? 400
      : 500
  return noStore(NextResponse.json({ error: message }, { status }))
}

export async function GET(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const clientId = String(request.nextUrl.searchParams.get("clientId") || "").trim()
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
    const access = await requireKnowledgeImportAccess({
      userId: auth.userId,
      clientId,
      teamId,
      action: "view",
    })
    const imports = await listWorkspaceKnowledgeImports(access.dataOwnerUserId, clientId, 20)
    return noStore(NextResponse.json({ imports }))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  if (Number(request.headers.get("content-length") || 0) > MAX_REQUEST_BYTES) {
    return noStore(NextResponse.json({ error: "单次上传总大小不能超过 45MB" }, { status: 413 }))
  }

  try {
    const form = await request.formData()
    const clientId = String(form.get("clientId") || "").trim()
    const teamId = String(form.get("teamId") || "").trim() || undefined
    const requestId = String(form.get("requestId") || "").trim()
    if (!/^[A-Za-z0-9_-]{16,160}$/.test(requestId)) throw new Error("导入请求编号无效，请刷新后重试")

    const access = await requireKnowledgeImportAccess({
      userId: auth.userId,
      clientId,
      teamId,
      action: "edit",
    })
    const existing = await findKnowledgeImportByRequest(access.actorUserId, requestId)
    if (existing) {
      const visible = await getPublicWorkspaceKnowledgeImport(
        existing.id,
        access.dataOwnerUserId,
        clientId,
      )
      if (visible) return noStore(NextResponse.json({ import: visible, reused: true }))
    }

    const uploaded = form.getAll("files").filter((value): value is File => value instanceof File)
    validateKnowledgeImportFiles(uploaded.map(file => ({ name: file.name, size: file.size })))
    const parsed: Awaited<ReturnType<typeof parseKnowledgeImportFile>>[] = []
    const originalFiles: Array<{ metadata: Awaited<ReturnType<typeof parseKnowledgeImportFile>>["metadata"]; buffer: Buffer }> = []
    for (const file of uploaded) {
      const buffer = Buffer.from(await file.arrayBuffer())
      const item = await parseKnowledgeImportFile({
        id: `kfile_${randomUUID().replace(/-/g, "")}`,
        name: file.name,
        mimeType: file.type,
        buffer,
      })
      parsed.push(item)
      originalFiles.push({ metadata: item.metadata, buffer })
    }

    const client = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(item => item.client.id === clientId)?.client
    if (!client) throw new Error("客户不存在或已被删除")
    const payload = {
      files: parsed.flatMap(item => item.payloadFiles),
      projectInfo: {
        project_name: client.name,
        subject_type: client.subjectType,
        person_profile: client.personProfile ? JSON.stringify(client.personProfile) : undefined,
        industry: client.industry,
        product_description: client.keywordStrategy?.extractedProfile?.product_description
          || client.keywordStrategy?.productDesc
          || "",
        competitors_raw: client.competitors.join("\n"),
      },
    }
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_BACKGROUND_PAYLOAD_BYTES) {
      throw new Error("解析后的资料内容超过 21MB，请拆成两批上传")
    }

    const record = await createKnowledgeImportRecord({
      ownerUserId: access.actorUserId,
      workspaceOwnerUserId: access.dataOwnerUserId,
      clientId,
      teamId: access.teamId,
      requestId,
      files: originalFiles,
    })
    const created = await createBackgroundJob({
      kind: "knowledgeImport",
      clientId,
      requestId,
      payload,
      ownerUserId: access.actorUserId,
      billingUserId: access.billingUserId,
      runtimeUserId: access.billingUserId,
      workspaceOwnerUserId: access.dataOwnerUserId,
      teamId: access.teamId,
    })
    if (!created.ok) {
      const detail = await created.response.json().catch(() => ({})) as { error?: string }
      await patchKnowledgeImportRecord(record.id, current => {
        current.status = "failed"
        current.stage = "资料提炼任务创建失败"
        current.error = detail.error || "后台任务创建失败"
      })
      return noStore(NextResponse.json({ error: detail.error || "后台任务创建失败" }, {
        status: created.response.status,
      }))
    }
    await patchKnowledgeImportRecord(record.id, current => {
      current.backgroundJobId = created.job.id
      current.status = "extracting"
      current.stage = "正在提炼可审核的事实资料"
      current.progressPercent = 20
      current.error = undefined
    })
    const result = await getPublicWorkspaceKnowledgeImport(record.id, access.dataOwnerUserId, clientId)
    return noStore(NextResponse.json({ import: result, reused: created.reused }, {
      status: created.reused ? 200 : 202,
    }))
  } catch (error) {
    return errorResponse(error)
  }
}
