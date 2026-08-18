import { NextRequest, NextResponse } from "next/server"
import {
  MAX_EVIDENCE_IMPORT_ROWS,
  validateEvidenceImportRows,
} from "@/lib/client-feedback/evidence-import"
import { saveClientExecutionActionBatch } from "@/lib/client-feedback/store"
import {
  previewPublishingEvidenceImport,
  reconcilePublishingEvidenceActions,
} from "@/lib/publishing-plan/evidence-reconciliation"
import {
  isOperationAccessError,
  requireOperationAccess,
} from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"
import type {
  ClientEvidenceImportDefaults,
  ClientEvidenceImportRowInput,
  ClientExecutionActionCategory,
  ClientExecutionActionStatus,
  ClientExecutionActionVisibility,
} from "@/types/client-feedback"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BATCH_BODY_BYTES = 600 * 1024
const CATEGORIES = new Set<ClientExecutionActionCategory>([
  "penetration_check",
  "content_production",
  "self_media_publish",
  "authority_media_publish",
  "video_publish",
  "website_optimization",
  "strategy_adjustment",
  "client_communication",
  "other",
])
const STATUSES = new Set<ClientExecutionActionStatus>(["planned", "completed"])
const VISIBILITIES = new Set<ClientExecutionActionVisibility>(["client", "internal"])

function noStore(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      ...init?.headers,
      "Cache-Control": "private, no-store, no-cache, must-revalidate",
    },
  })
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const contentLength = Number(request.headers.get("content-length") || 0)
    if (contentLength > MAX_BATCH_BODY_BYTES) {
      return noStore({ error: "批量导入内容过多，请拆分后重试" }, { status: 413 })
    }
    const { clientId } = await context.params
    const body = await request.json() as {
      importId?: unknown
      teamId?: unknown
      defaults?: Partial<ClientEvidenceImportDefaults>
      rows?: unknown
      preview?: unknown
      reconcilePublishingQuota?: unknown
    }
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "feedback",
      action: "edit",
      teamId: typeof body.teamId === "string" ? body.teamId : undefined,
    })
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return noStore({ error: "请至少填写一条标题和证据网址" }, { status: 400 })
    }
    if (body.rows.length > MAX_EVIDENCE_IMPORT_ROWS) {
      return noStore(
        { error: `单次最多导入 ${MAX_EVIDENCE_IMPORT_ROWS} 条` },
        { status: 400 },
      )
    }
    const rows: ClientEvidenceImportRowInput[] = body.rows.map(value => {
      const row = value && typeof value === "object"
        ? value as Record<string, unknown>
        : {}
      return {
        title: text(row.title),
        url: text(row.url),
        platform: text(row.platform),
        platformKey: text(row.platformKey),
      }
    })
    const category = CATEGORIES.has(body.defaults?.category as ClientExecutionActionCategory)
      ? body.defaults?.category as ClientExecutionActionCategory
      : "self_media_publish"
    const status = STATUSES.has(body.defaults?.status as ClientExecutionActionStatus)
      ? body.defaults?.status as ClientExecutionActionStatus
      : "completed"
    const visibility = VISIBILITIES.has(body.defaults?.visibility as ClientExecutionActionVisibility)
      ? body.defaults?.visibility as ClientExecutionActionVisibility
      : "client"
    const defaults: ClientEvidenceImportDefaults = {
      category,
      status,
      visibility,
      occurredDate: text(body.defaults?.occurredDate),
      description: text(body.defaults?.description),
    }
    const shouldReconcile = status === "completed"
      && ["self_media_publish", "authority_media_publish", "video_publish"].includes(category)
      && body.reconcilePublishingQuota !== false
    if (body.preview === true) {
      const previewRows = validateEvidenceImportRows(rows).filter(row => !row.error)
      const preview = shouldReconcile
        ? await previewPublishingEvidenceImport({
            ownerUserId: access.dataOwnerUserId,
            clientId: access.clientId,
            occurredDate: defaults.occurredDate,
            rows: previewRows,
          })
        : null
      return noStore({
        preview: preview ? {
          ...preview,
          rows: preview.rows.map((row, index) => ({
            ...row,
            rowNumber: previewRows[index]?.rowNumber || row.rowNumber,
          })),
        } : null,
      })
    }
    const result = await saveClientExecutionActionBatch({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      actorUserId: auth.userId,
      importId: text(body.importId),
      defaults,
      rows,
    })
    if (!shouldReconcile || result.created.length === 0) {
      return noStore(result, { status: 201 })
    }
    const reconciliation = await reconcilePublishingEvidenceActions({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      actorUserId: auth.userId,
      actions: result.created,
    })
    return noStore({
      ...result,
      created: reconciliation.actions,
      reconciliation: reconciliation.summary,
    }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量导入动作失败"
    return noStore(
      { error: message },
      {
        status: isOperationAccessError(error)
          ? 403
          : /正在导入/.test(message)
            ? 409
            : 400,
      },
    )
  }
}
