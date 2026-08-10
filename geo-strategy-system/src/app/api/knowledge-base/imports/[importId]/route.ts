import { NextRequest, NextResponse } from "next/server"
import { cancelBackgroundJob, getBackgroundJob } from "@/lib/background-jobs"
import { normalizeClientKnowledgeBase } from "@/lib/client-knowledge-base"
import { buildKnowledgeImportCandidates } from "@/lib/knowledge-import/candidates"
import {
  isKnowledgeImportAccessError,
  requireKnowledgeImportAccess,
} from "@/lib/knowledge-import/access"
import {
  getPublicWorkspaceKnowledgeImport,
  getWorkspaceKnowledgeImport,
  patchKnowledgeImportRecord,
  setKnowledgeImportCandidates,
} from "@/lib/knowledge-import/store"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"
import type { ExtractedProfile } from "@/types/geo-strategy"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  return response
}

function fail(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "资料导入状态读取失败"
  return noStore(NextResponse.json({ error: message }, {
    status: isKnowledgeImportAccessError(error) ? 403 : 500,
  }))
}

async function contextFor(request: NextRequest, importId: string, action: "view" | "edit") {
  const auth = await requireUserId()
  if (!auth.ok) return { response: auth.response }
  const clientId = String(request.nextUrl.searchParams.get("clientId") || "").trim()
  const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
  const access = await requireKnowledgeImportAccess({ userId: auth.userId, clientId, teamId, action })
  const record = await getWorkspaceKnowledgeImport(importId, access.dataOwnerUserId, clientId)
  if (!record) return { response: noStore(NextResponse.json({ error: "导入记录不存在" }, { status: 404 })) }
  return { auth, access, record, clientId }
}

export async function GET(
  request: NextRequest,
  route: { params: Promise<{ importId: string }> },
) {
  try {
    const { importId } = await route.params
    const context = await contextFor(request, importId, "view")
    if (context.response) return context.response
    let record = context.record
    if (record.backgroundJobId && ["queued", "extracting"].includes(record.status)) {
      const job = await getBackgroundJob(record.backgroundJobId, record.ownerUserId)
      if (job?.status === "succeeded") {
        const client = (await listWorkspaceClients(context.access.dataOwnerUserId))
          .find(item => item.client.id === context.clientId)?.client
        if (!client) throw new Error("客户资料已不存在")
        const knowledgeBase = normalizeClientKnowledgeBase(client.knowledgeBase, {
          subjectType: client.subjectType,
          subjectName: client.ourBrand || client.name,
          aliases: client.brandAliases,
        })
        const candidates = buildKnowledgeImportCandidates({
          profile: job.result as ExtractedProfile,
          files: record.files,
          knowledgeBase,
          importId: record.id,
        })
        record = await patchKnowledgeImportRecord(record.id, current => {
          setKnowledgeImportCandidates(current, candidates)
          current.finishedAt = job.finishedAt
        }) || record
      } else if (job?.status === "failed" || job?.status === "cancelled") {
        const terminalStatus = job.status === "cancelled" ? "cancelled" : "failed"
        record = await patchKnowledgeImportRecord(record.id, current => {
          current.status = terminalStatus
          current.stage = terminalStatus === "cancelled" ? "导入已取消" : "资料提炼失败"
          current.error = job.error
          current.progressPercent = job.progressPercent
          current.finishedAt = job.finishedAt
        }) || record
      } else if (job) {
        record = await patchKnowledgeImportRecord(record.id, current => {
          current.status = "extracting"
          current.stage = job.stage || "正在提炼可审核的事实资料"
          current.progressPercent = Math.max(20, Math.min(90, job.progressPercent || 20))
        }) || record
      }
    }
    const visible = await getPublicWorkspaceKnowledgeImport(
      record.id,
      context.access.dataOwnerUserId,
      context.clientId,
    )
    return noStore(NextResponse.json({ import: visible }))
  } catch (error) {
    return fail(error)
  }
}

export async function PATCH(
  request: NextRequest,
  route: { params: Promise<{ importId: string }> },
) {
  try {
    const { importId } = await route.params
    const context = await contextFor(request, importId, "edit")
    if (context.response) return context.response
    if (context.record.backgroundJobId) {
      await cancelBackgroundJob(context.record.backgroundJobId, context.record.ownerUserId)
    }
    await patchKnowledgeImportRecord(context.record.id, current => {
      current.status = "cancelled"
      current.stage = "导入已取消"
      current.error = undefined
      current.finishedAt = new Date().toISOString()
    })
    const visible = await getPublicWorkspaceKnowledgeImport(
      context.record.id,
      context.access.dataOwnerUserId,
      context.clientId,
    )
    return noStore(NextResponse.json({ import: visible }))
  } catch (error) {
    return fail(error)
  }
}
