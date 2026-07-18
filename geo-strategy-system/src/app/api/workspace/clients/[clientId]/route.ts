import { NextRequest, NextResponse } from "next/server"
import { requireUserId } from "@/lib/with-credits"
import {
  WorkspaceConflictError,
  deleteWorkspaceClient,
  patchWorkspaceClient,
} from "@/lib/workspace-store"
import {
  filterClientPatch,
  filterUnsetFields,
  normalizeWorkspaceVersions,
  WorkspaceValidationError,
} from "@/lib/workspace-sync"
import {
  CLIENT_ACCOUNT_ALLOWED_PATCH_FIELDS,
  resolveWorkspaceAccess,
} from "@/lib/client-accounts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const MAX_BODY_BYTES = 25 * 1024 * 1024

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return noStore(NextResponse.json({ error: "客户数据超过单次同步限制" }, { status: 413 }))
  }
  const { clientId } = await context.params
  const access = await resolveWorkspaceAccess(auth.userId, clientId)
  if (!access.ok) {
    return noStore(NextResponse.json(
      { error: access.message, code: access.code },
      { status: 403 },
    ))
  }
  try {
    const body = await request.json() as {
      patch?: unknown
      unsetFields?: unknown
      expectedVersions?: unknown
      force?: unknown
    }
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) {
      throw new WorkspaceValidationError("客户数据超过单次同步限制")
    }
    const patch = filterClientPatch(body.patch)
    const unsetFields = filterUnsetFields(body.unsetFields)
    if (access.mode === "client") {
      const disallowed = [...Object.keys(patch), ...unsetFields]
        .filter(field => !CLIENT_ACCOUNT_ALLOWED_PATCH_FIELDS.has(String(field)))
      if (disallowed.length > 0) {
        return noStore(NextResponse.json({
          error: "客户专属账号只能修改疑问句、检测模型和渗透率检测结果",
          code: "CLIENT_ACCOUNT_READ_ONLY",
          fields: disallowed,
        }, { status: 403 }))
      }
    }
    const synced = await patchWorkspaceClient({
      userId: access.ownerUserId,
      clientId,
      patch,
      unsetFields,
      expectedVersions: normalizeWorkspaceVersions(body.expectedVersions),
      force: body.force === true,
    })
    if (!synced) {
      return noStore(NextResponse.json({ error: "客户不存在" }, { status: 404 }))
    }
    return noStore(NextResponse.json(synced))
  } catch (error) {
    if (error instanceof WorkspaceConflictError) {
      return noStore(NextResponse.json({
        error: error.message,
        code: "WORKSPACE_CONFLICT",
        conflictingSections: error.conflictingSections,
        current: error.current,
      }, { status: 409 }))
    }
    if (error instanceof WorkspaceValidationError || error instanceof SyntaxError) {
      return noStore(NextResponse.json({ error: error.message }, { status: 400 }))
    }
    console.error("[workspace-client] patch failed", error)
    return noStore(NextResponse.json({ error: "云端保存失败，请稍后重试" }, { status: 503 }))
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  const { clientId } = await context.params
  const access = await resolveWorkspaceAccess(auth.userId, clientId)
  if (!access.ok || access.mode === "client") {
    return noStore(NextResponse.json(
      {
        error: access.ok
          ? "客户专属账号不能删除客户"
          : access.message,
        code: "CLIENT_ACCOUNT_READ_ONLY",
      },
      { status: 403 },
    ))
  }
  try {
    const deleted = await deleteWorkspaceClient(access.ownerUserId, clientId)
    if (!deleted) {
      return noStore(NextResponse.json({ error: "客户不存在" }, { status: 404 }))
    }
    return noStore(NextResponse.json({ ok: true }))
  } catch (error) {
    console.error("[workspace-client] delete failed", error)
    return noStore(NextResponse.json({ error: "删除客户失败" }, { status: 503 }))
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  response.headers.set("Pragma", "no-cache")
  return response
}
