import { NextRequest, NextResponse } from "next/server"
import { normalizeClientKnowledgeBase } from "@/lib/client-knowledge-base"
import { mergeApprovedKnowledgeCandidates } from "@/lib/knowledge-import/candidates"
import {
  isKnowledgeImportAccessError,
  requireKnowledgeImportAccess,
} from "@/lib/knowledge-import/access"
import {
  acquireKnowledgeImportCommitLease,
  getPublicWorkspaceKnowledgeImport,
  getWorkspaceKnowledgeImport,
  patchKnowledgeImportRecord,
  releaseKnowledgeImportCommitLease,
} from "@/lib/knowledge-import/store"
import { requireUserId } from "@/lib/with-credits"
import { mutateWorkspaceClientLatest } from "@/lib/workspace-store"
import type { GeoEvidenceLevel, GeoKnowledgeAssetKind } from "@/types/geo-methodology"
import type { KnowledgeImportCandidate } from "@/types/knowledge-import"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

const KINDS = new Set<GeoKnowledgeAssetKind>([
  "identity", "product", "service", "advantage", "credential", "report", "case",
  "quote", "pricing", "media", "competitor", "boundary", "other",
])
const EVIDENCE = new Set<GeoEvidenceLevel>([
  "official", "primary", "verifiedThirdParty", "ownedRecord", "context",
])

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  return response
}

function clean(value: unknown, limit: number): string {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, limit)
}

function strings(value: unknown, limit: number, itemLimit: number): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => clean(item, itemLimit))
    .filter(Boolean))].slice(0, limit)
}

function applyEdits(
  stored: KnowledgeImportCandidate[],
  edits: unknown,
): KnowledgeImportCandidate[] {
  const patches = new Map(
    (Array.isArray(edits) ? edits : [])
      .filter(value => value && typeof value === "object" && !Array.isArray(value))
      .map(value => [String((value as { id?: unknown }).id || ""), value as Record<string, unknown>]),
  )
  return stored.map(candidate => {
    const patch = patches.get(candidate.id)
    if (!patch) return { ...candidate, selected: false }
    const kind = String(patch.kind || candidate.kind) as GeoKnowledgeAssetKind
    const evidenceLevel = String(patch.evidenceLevel || candidate.evidenceLevel) as GeoEvidenceLevel
    return {
      ...candidate,
      kind: KINDS.has(kind) ? kind : candidate.kind,
      evidenceLevel: EVIDENCE.has(evidenceLevel) ? evidenceLevel : candidate.evidenceLevel,
      title: clean(patch.title ?? candidate.title, 300),
      content: clean(patch.content ?? candidate.content, 12_000),
      tags: strings(patch.tags ?? candidate.tags, 30, 120),
      sourceUrls: strings(patch.sourceUrls ?? candidate.sourceUrls, 30, 2_000)
        .filter(url => /^https?:\/\//i.test(url)),
      occurredAt: clean(patch.occurredAt ?? candidate.occurredAt, 80) || undefined,
      selected: patch.selected === true,
    }
  })
}

export async function POST(
  request: NextRequest,
  route: { params: Promise<{ importId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  let recordId = ""
  let commitLeaseToken: string | null = null
  try {
    const { importId } = await route.params
    recordId = importId
    const clientId = String(request.nextUrl.searchParams.get("clientId") || "").trim()
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
    const access = await requireKnowledgeImportAccess({
      userId: auth.userId,
      clientId,
      teamId,
      action: "edit",
    })
    const record = await getWorkspaceKnowledgeImport(importId, access.dataOwnerUserId, clientId)
    if (!record) return noStore(NextResponse.json({ error: "导入记录不存在" }, { status: 404 }))
    if (record.status !== "review" && record.status !== "completed") {
      return noStore(NextResponse.json({ error: "资料尚未完成提炼，暂时不能入库" }, { status: 409 }))
    }
    const body = await request.json().catch(() => ({})) as { candidates?: unknown }
    const candidates = applyEdits(record.candidates, body.candidates)
    const selected = candidates.filter(candidate => candidate.selected && candidate.title && candidate.content)
    if (selected.length === 0) {
      return noStore(NextResponse.json({ error: "请至少勾选一条完整的候选资料" }, { status: 400 }))
    }

    commitLeaseToken = await acquireKnowledgeImportCommitLease(record.id)
    if (!commitLeaseToken) {
      return noStore(NextResponse.json({ error: "该批资料正在入库，请稍后刷新导入记录" }, { status: 409 }))
    }

    await patchKnowledgeImportRecord(record.id, current => {
      current.status = "committing"
      current.stage = "正在写入客户资料库"
      current.progressPercent = 100
      current.error = undefined
      current.candidates = candidates
    })

    let addedCount = 0
    let skippedCount = 0
    const synced = await mutateWorkspaceClientLatest({
      userId: access.dataOwnerUserId,
      clientId,
      mutate: current => {
        const subjectName = current.ourBrand || current.name
        const knowledgeBase = normalizeClientKnowledgeBase(current.knowledgeBase, {
          subjectType: current.subjectType,
          subjectName,
          aliases: current.brandAliases,
        })
        const merged = mergeApprovedKnowledgeCandidates({
          knowledgeBase,
          candidates,
          files: record.files,
          importId: record.id,
          subjectName,
          subjectType: current.subjectType,
        })
        addedCount = merged.addedCount
        skippedCount = merged.skippedCount
        return { patch: { knowledgeBase: merged.knowledgeBase } }
      },
    })
    if (!synced) throw new Error("客户资料已不存在")

    await patchKnowledgeImportRecord(record.id, current => {
      current.status = "completed"
      current.stage = addedCount > 0
        ? `已写入 ${addedCount} 条资料`
        : "所选资料已存在，无需重复写入"
      current.approvedCount = addedCount
      current.candidates = candidates.map(candidate => candidate.selected
        ? { ...candidate, status: "reviewed" }
        : candidate)
      current.error = skippedCount > 0 ? `${skippedCount} 条重复资料已跳过` : undefined
      current.finishedAt = new Date().toISOString()
    })
    const visible = await getPublicWorkspaceKnowledgeImport(record.id, access.dataOwnerUserId, clientId)
    return noStore(NextResponse.json({
      import: visible,
      knowledgeBase: synced.client.knowledgeBase,
      versions: synced.versions,
      addedCount,
      skippedCount,
    }))
  } catch (error) {
    if (recordId) {
      await patchKnowledgeImportRecord(recordId, current => {
        if (current.status === "committing") current.status = "review"
        current.stage = "入库未完成，请检查后重试"
        current.error = error instanceof Error ? error.message : "资料入库失败"
      }).catch(() => undefined)
    }
    const message = error instanceof Error ? error.message : "资料入库失败"
    return noStore(NextResponse.json({ error: message }, {
      status: isKnowledgeImportAccessError(error) ? 403 : 500,
    }))
  } finally {
    if (recordId && commitLeaseToken) {
      await releaseKnowledgeImportCommitLease(recordId, commitLeaseToken).catch(() => undefined)
    }
  }
}
