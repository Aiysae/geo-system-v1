import { randomBytes } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import {
  createUser,
  getUserByEmail,
  getUserById,
  updateUserStatus,
} from "@/lib/auth"
import {
  getClientAccountLink,
  listClientAccountLinks,
  listClientAccountLinksForOwner,
  saveClientAccountLink,
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
import { listWorkspaceClients } from "@/lib/workspace-store"

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
  const link = await getClientAccountLink(userId)
  if (link) throw new Error("客户专属账号不能继续创建下级账号")
}

export async function GET() {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    await requireStandardOwner(auth.userId)
    const [membership, links, clients] = await Promise.all([
      getMembershipWithPaymentRepair(auth.userId),
      listClientAccountLinksForOwner(auth.userId),
      listWorkspaceClients(auth.userId),
    ])
    const accounts = await Promise.all(links.map(async link => {
      const [user, creditBalance] = await Promise.all([
        getUserById(link.userId),
        getCreditBalanceSnapshot(link.userId),
      ])
      return {
        userId: link.userId,
        email: user?.email || "",
        name: user?.name || link.clientName,
        clientId: link.clientId,
        clientName: link.clientName,
        status: link.status,
        billingMode: link.billingMode,
        provisioning: link.provisioning,
        creditBalance: creditBalance.total,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
      }
    }))
    return noStore(NextResponse.json({
      membership,
      used: links.length,
      limit: membership.clientAccountLimit,
      accounts,
      clients: clients.map(record => ({
        id: record.client.id,
        name: record.client.name,
        ourBrand: record.client.ourBrand,
        subjectType: record.client.subjectType,
        industry: record.client.industry,
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
    const body = await request.json() as { email?: unknown; name?: unknown; clientId?: unknown }
    const email = String(body.email || "").trim().toLowerCase()
    const name = String(body.name || "").trim().slice(0, 80)
    const clientId = String(body.clientId || "").trim().slice(0, 200)
    if (!email || !clientId) throw new Error("请填写客户邮箱并选择客户面板")

    const [membership, links, clients, existingUser, allLinks] = await Promise.all([
      getMembershipWithPaymentRepair(auth.userId),
      listClientAccountLinksForOwner(auth.userId),
      listWorkspaceClients(auth.userId),
      getUserByEmail(email),
      listClientAccountLinks(),
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
    const client = clients.find(record => record.client.id === clientId)?.client
    if (!client) throw new Error("客户面板不存在或不属于当前账号")
    if (allLinks.some(link => link.ownerUserId === auth.userId && link.clientId === clientId)) {
      throw new Error("该客户面板已经关联了一个客户专属账号")
    }

    const password = temporaryPassword()
    const child = await createUser({
      email,
      password,
      name: name || client.name,
      managedByUserId: auth.userId,
      mustChangePassword: true,
    })
    createdUserId = child.id
    await initializeManagedAccountCredits(child.id)
    const link = await saveClientAccountLink({
      userId: child.id,
      ownerUserId: auth.userId,
      clientId: client.id,
      clientName: client.name,
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
