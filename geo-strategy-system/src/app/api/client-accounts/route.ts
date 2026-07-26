import { randomBytes } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import {
  createUser,
  getUserByEmail,
  getUserById,
  listManagedUsers,
  updateUserStatus,
} from "@/lib/auth"
import {
  listClientCatalog,
  resolveClientAccessRef,
  type ResolvedClientAccessRef,
} from "@/lib/client-access-catalog"
import {
  getClientAccountLinkForSource,
  getClientAccountSourceState,
  getRecoverableClientAccountLink,
  listClientAccountLinksForOwner,
  saveClientAccountLink,
  type ClientAccountLink,
} from "@/lib/client-accounts"
import {
  getMembershipWithPaymentRepair,
  hasMembershipTier,
} from "@/lib/membership"
import {
  getCreditBalanceSnapshot,
  initializeManagedAccountCredits,
} from "@/lib/credits"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

function temporaryPassword(): string {
  return `ST-${randomBytes(9).toString("base64url")}7`
}

async function requireStandardOwner(userId: string) {
  const { getClientAccountLink } = await import("@/lib/client-accounts")
  const link = await getClientAccountLink(userId)
  if (link) throw new Error("客户专属账号不能继续创建下级账号")
}

function matchesSource(
  link: ClientAccountLink,
  source: ResolvedClientAccessRef,
): boolean {
  return link.parentUserId === source.parentUserId
    && link.dataOwnerUserId === source.dataOwnerUserId
    && link.clientId === source.client.id
    && link.sourceType === source.sourceType
    && (link.teamId || "") === (source.teamId || "")
}

async function sourceFromRequest(
  authUserId: string,
  clientRef: unknown,
  legacyClientId?: unknown,
): Promise<ResolvedClientAccessRef> {
  if (String(clientRef || "").trim()) {
    return resolveClientAccessRef(authUserId, clientRef)
  }
  const clientId = String(legacyClientId || "").trim()
  const personal = (await listClientCatalog(authUserId)).find(entry => (
    entry.sourceType === "personal" && entry.id === clientId
  ))
  if (!personal) throw new Error("客户面板不存在或不属于当前账号")
  return resolveClientAccessRef(authUserId, personal.accessRef)
}

export async function GET(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    await requireStandardOwner(auth.userId)
    const clientRef = String(request.nextUrl.searchParams.get("clientRef") || "").trim()
    const selectedSource = clientRef
      ? await resolveClientAccessRef(auth.userId, clientRef)
      : null
    if (selectedSource && !selectedSource.canManageClientAccount) {
      return noStore(NextResponse.json({
        error: "当前团队角色没有客户账号管理权限",
        code: "CLIENT_ACCOUNT_MANAGE_DENIED",
      }, { status: 403 }))
    }

    const sources = selectedSource
      ? [selectedSource]
      : (await listClientCatalog(auth.userId))
          .filter(entry => entry.sourceType === "personal")
          .map(entry => ({
            accessRef: entry.accessRef,
            sourceType: entry.sourceType,
            teamId: entry.teamId,
            teamName: entry.teamName,
            dataOwnerUserId: entry.dataOwnerUserId,
            parentUserId: entry.parentUserId,
            client: entry,
            canEdit: entry.canEdit,
            canDelete: entry.canDelete,
            canManageClientAccount: entry.canManageClientAccount,
          } satisfies ResolvedClientAccessRef))
    const parentUserId = selectedSource?.parentUserId || auth.userId
    const [membership, allParentLinks, managedUsers] = await Promise.all([
      getMembershipWithPaymentRepair(parentUserId),
      listClientAccountLinksForOwner(parentUserId),
      listManagedUsers(parentUserId),
    ])
    const links = allParentLinks.filter(link => sources.some(source => matchesSource(link, source)))
    const accounts = await Promise.all(links.map(async link => {
      const [user, creditBalance, source] = await Promise.all([
        getUserById(link.userId),
        getCreditBalanceSnapshot(link.userId),
        getClientAccountSourceState(link),
      ])
      return {
        userId: link.userId,
        email: user?.email || "",
        name: user?.name || link.clientName,
        clientId: link.clientId,
        clientName: link.clientName,
        status: link.status,
        sourceStatus: source.ok ? "active" : "revoked",
        billingMode: link.billingMode,
        provisioning: link.provisioning,
        creditBalance: creditBalance.total,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
      }
    }))
    const linkedUserIds = new Set(allParentLinks.map(link => link.userId))
    const detachedAccounts = (await Promise.all(
      managedUsers
        .filter(user => !linkedUserIds.has(user.id))
        .map(async user => {
          const previous = await getRecoverableClientAccountLink(user.id, parentUserId)
          const source = previous
            ? sources.find(item => matchesSource(previous, item))
            : null
          if (!previous || !source) return null
          const [creditBalance, sourceState] = await Promise.all([
            getCreditBalanceSnapshot(user.id),
            getClientAccountSourceState(previous),
          ])
          const duplicate = allParentLinks.some(link => (
            link.userId !== user.id && matchesSource(link, source)
          ))
          const canRestore = sourceState.ok && !duplicate
          const sourceError = sourceState.ok ? "" : sourceState.message
          return {
            userId: user.id,
            email: user.email,
            name: user.name,
            clientId: previous.clientId,
            clientName: previous.clientName,
            creditBalance: creditBalance.total,
            canRestore,
            unavailableReason: canRestore
              ? ""
              : duplicate
                ? "该客户已关联其他子账号"
                : sourceError,
            updatedAt: user.updatedAt,
          }
        }),
    )).filter(account => account !== null)

    return noStore(NextResponse.json({
      membership,
      used: allParentLinks.length,
      limit: membership.clientAccountLimit,
      canTransferCredits: parentUserId === auth.userId,
      accounts,
      detachedAccounts,
      clients: sources.map(source => ({
        id: source.client.id,
        accessRef: source.accessRef,
        name: source.client.name,
        ourBrand: source.client.ourBrand,
        subjectType: source.client.subjectType,
        industry: source.client.industry,
        sourceType: source.sourceType,
        teamName: source.teamName,
      })),
    }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "客户账号读取失败",
    }, { status: 403 }))
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  let createdUserId: string | null = null
  try {
    await requireStandardOwner(auth.userId)
    const body = await request.json() as {
      email?: unknown
      name?: unknown
      clientId?: unknown
      clientRef?: unknown
    }
    const email = String(body.email || "").trim().toLowerCase()
    const name = String(body.name || "").trim().slice(0, 80)
    if (!email) throw new Error("请填写客户邮箱")

    const source = await sourceFromRequest(auth.userId, body.clientRef, body.clientId)
    if (!source.canManageClientAccount) {
      return noStore(NextResponse.json({
        error: "当前团队角色没有客户账号管理权限",
        code: "CLIENT_ACCOUNT_MANAGE_DENIED",
      }, { status: 403 }))
    }
    const [membership, links, existingUser, duplicate] = await Promise.all([
      getMembershipWithPaymentRepair(source.parentUserId),
      listClientAccountLinksForOwner(source.parentUserId),
      getUserByEmail(email),
      getClientAccountLinkForSource({
        parentUserId: source.parentUserId,
        dataOwnerUserId: source.dataOwnerUserId,
        sourceType: source.sourceType,
        teamId: source.teamId,
        clientId: source.client.id,
      }),
    ])
    if (!hasMembershipTier(membership, "vip2")) {
      return noStore(NextResponse.json({
        error: "累计实际充值达到 100 元并升级 VIP2 后可创建客户子账号",
        code: "VIP2_REQUIRED",
      }, { status: 403 }))
    }
    if (links.length >= membership.clientAccountLimit) {
      return noStore(NextResponse.json({
        error: `当前 ${membership.tier.toUpperCase()} 最多可创建 ${membership.clientAccountLimit} 个客户子账号`,
        code: "CLIENT_ACCOUNT_LIMIT_REACHED",
      }, { status: 403 }))
    }
    if (existingUser) throw new Error("该邮箱已经注册，请换一个未使用的客户邮箱")
    if (duplicate) throw new Error("该客户面板已经关联了一个客户专属账号")

    const password = temporaryPassword()
    const child = await createUser({
      email,
      password,
      name: name || source.client.name,
      managedByUserId: source.parentUserId,
      mustChangePassword: true,
    })
    createdUserId = child.id
    await initializeManagedAccountCredits(child.id)
    const link = await saveClientAccountLink({
      userId: child.id,
      parentUserId: source.parentUserId,
      dataOwnerUserId: source.dataOwnerUserId,
      sourceType: source.sourceType,
      teamId: source.teamId,
      clientId: source.client.id,
      clientName: source.client.name,
      monthlyCredits: 0,
      provisioning: "owner",
      billingMode: "self_funded",
      operatorUserId: auth.userId,
    })
    return noStore(NextResponse.json({
      account: {
        userId: child.id,
        email: child.email,
        name: child.name,
        clientId: link.clientId,
        clientName: link.clientName,
        status: link.status,
      },
      temporaryPassword: password,
    }, { status: 201 }))
  } catch (error) {
    if (createdUserId) await updateUserStatus(createdUserId, "disabled").catch(() => undefined)
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "客户子账号创建失败",
    }, { status: 400 }))
  }
}
