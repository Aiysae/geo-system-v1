"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Check,
  Copy,
  Coins,
  Crown,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Unlink,
  UsersRound,
  X,
} from "lucide-react"
import type { MembershipSnapshot } from "@/types"
import { toUserFacingError } from "@/lib/user-facing-errors"

type ClientOption = {
  id: string
  name: string
  ourBrand: string
  subjectType: "brand" | "person"
  industry: string
}

type ManagedAccount = {
  userId: string
  email: string
  name: string
  clientId: string
  clientName: string
  status: "active" | "suspended"
  billingMode: "monthly_grant" | "self_funded"
  provisioning: "admin" | "owner"
  creditBalance: number
  createdAt: string
  updatedAt: string
}

type DetachedAccount = {
  userId: string
  email: string
  name: string
  clientId: string
  clientName: string
  creditBalance: number
  canRestore: boolean
  unavailableReason: string
  updatedAt: string
}

type AccountPayload = {
  membership: MembershipSnapshot
  used: number
  limit: number
  accounts: ManagedAccount[]
  detachedAccounts: DetachedAccount[]
  clients: ClientOption[]
}

type Credential = {
  email: string
  temporaryPassword: string
}

const EMPTY_MEMBERSHIP: MembershipSnapshot = {
  tier: "free",
  active: false,
  paidCents: 0,
  qualifyingOrderCount: 0,
  clientAccountLimit: 0,
}

export default function ClientAccountManager() {
  const [payload, setPayload] = useState<AccountPayload>({
    membership: EMPTY_MEMBERSHIP,
    used: 0,
    limit: 0,
    accounts: [],
    detachedAccounts: [],
    clients: [],
  })
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState("")
  const [error, setError] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [credential, setCredential] = useState<Credential | null>(null)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState("")
  const [transferTarget, setTransferTarget] = useState<ManagedAccount | null>(null)
  const [transferAmount, setTransferAmount] = useState("100")
  const [transferOperationId, setTransferOperationId] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch("/api/client-accounts", { cache: "no-store" })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, { status: response.status, fallback: "客户账号读取失败，请稍后重试。", subject: "客户账号" }))
      setPayload({
        ...(body as AccountPayload),
        detachedAccounts: Array.isArray(body?.detachedAccounts) ? body.detachedAccounts : [],
      })
    } catch (loadError) {
      setError(toUserFacingError(loadError, { fallback: "客户账号读取失败，请稍后重试。", subject: "客户账号" }))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const availableClients = useMemo(() => {
    const linkedIds = new Set(payload.accounts.map(account => account.clientId))
    payload.detachedAccounts
      .filter(account => account.canRestore)
      .forEach(account => linkedIds.add(account.clientId))
    return payload.clients.filter(client => !linkedIds.has(client.id))
  }, [payload.accounts, payload.clients, payload.detachedAccounts])
  const canCreate = payload.membership.clientAccountLimit > payload.used

  async function createAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending("create")
    setError("")
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch("/api/client-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") || ""),
          name: String(form.get("name") || ""),
          clientId: String(form.get("clientId") || ""),
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, { status: response.status, fallback: "客户子账号创建失败，请稍后重试。", subject: "创建客户账号" }))
      setCredential({
        email: body.account.email,
        temporaryPassword: body.temporaryPassword,
      })
      setShowCreate(false)
      await load()
    } catch (createError) {
      setError(toUserFacingError(createError, { fallback: "客户子账号创建失败，请稍后重试。", subject: "创建客户账号" }))
    } finally {
      setPending("")
    }
  }

  async function accountAction(account: ManagedAccount, action: "status" | "reset" | "remove") {
    if (action === "remove" && !window.confirm(
      `确认解除“${account.clientName}”的客户账号关联吗？\n\n账号会暂停登录，但账号、积分和历史数据都会保留，可在“已解除客户账号”中恢复。`,
    )) {
      return
    }
    const key = `${action}:${account.userId}`
    setPending(key)
    setError("")
    try {
      const endpoint = `/api/client-accounts/${encodeURIComponent(account.userId)}`
      const response = action === "remove"
        ? await fetch(endpoint, { method: "DELETE" })
        : await fetch(endpoint, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(action === "reset"
              ? { action: "reset-password" }
              : { action: "status", status: account.status === "active" ? "suspended" : "active" }),
          })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, { status: response.status, fallback: "客户账号操作失败，请稍后重试。", subject: "客户账号操作" }))
      if (action === "reset") {
        setCredential({ email: body.email, temporaryPassword: body.temporaryPassword })
      }
      await load()
      if (action === "remove") {
        setNotice(`已解除“${account.clientName}”的关联，可随时在下方恢复。`)
      }
    } catch (actionError) {
      setError(toUserFacingError(actionError, { fallback: "客户账号操作失败，请稍后重试。", subject: "客户账号操作" }))
    } finally {
      setPending("")
    }
  }

  function openTransfer(account: ManagedAccount) {
    setTransferTarget(account)
    setTransferAmount("100")
    setTransferOperationId(`ct_${crypto.randomUUID().replace(/-/g, "")}`)
    setError("")
    setNotice("")
  }

  async function restoreAccount(account: DetachedAccount) {
    const key = `restore:${account.userId}`
    setPending(key)
    setError("")
    setNotice("")
    try {
      const response = await fetch(`/api/client-accounts/${encodeURIComponent(account.userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, {
        status: response.status,
        fallback: "客户账号恢复失败，请稍后重试。",
        subject: "恢复客户账号",
      }))
      setNotice(`已恢复“${body.clientName || account.clientName}”，该账号现在可以正常登录。`)
      await load()
    } catch (restoreError) {
      setError(toUserFacingError(restoreError, { fallback: "客户账号恢复失败，请稍后重试。", subject: "恢复客户账号" }))
    } finally {
      setPending("")
    }
  }

  async function transferCredits() {
    if (!transferTarget) return
    const amount = Math.floor(Number(transferAmount))
    if (!Number.isFinite(amount) || amount < 1) {
      setError("请输入正确的积分数量")
      return
    }
    setPending(`credits:${transferTarget.userId}`)
    setError("")
    setNotice("")
    try {
      const response = await fetch(`/api/client-accounts/${encodeURIComponent(transferTarget.userId)}/credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: transferOperationId, amount }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, { status: response.status, fallback: "积分分配失败，请稍后重试。", subject: "积分分配" }))
      setNotice(`已向 ${transferTarget.clientName} 分配 ${amount} 积分`)
      setTransferTarget(null)
      await load()
    } catch (transferError) {
      setError(toUserFacingError(transferError, { fallback: "积分分配失败，请稍后重试。", subject: "积分分配" }))
    } finally {
      setPending("")
    }
  }

  async function copyCredential() {
    if (!credential) return
    await navigator.clipboard.writeText(
      `势途 GEO 客户专属账号\n登录邮箱：${credential.email}\n临时密码：${credential.temporaryPassword}\n登录地址：${window.location.origin}/sign-in`,
    )
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="min-h-screen geo-saturated-bg text-[#102A43]">
      <header className="sticky top-0 z-30 border-b border-white/12 bg-[#001D66]/96 text-white backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00C8FF] shadow-sm">
              <UsersRound className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-base font-semibold">客户账号管理</h1>
              <p className="text-[11px] text-cyan-100/70">一个子账号只对应一个客户面板</p>
            </div>
          </div>
          <Link href="/workspace" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/20 px-3 text-xs font-semibold hover:bg-white/10">
            <ArrowLeft className="h-3.5 w-3.5" />
            返回工作台
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-8">
        <section className="overflow-hidden rounded-lg border border-[#A7D8FF] bg-white shadow-[0_18px_44px_-32px_rgba(0,77,180,0.55)]">
          <div className="grid gap-px bg-[#DCEBFA] md:grid-cols-[1.2fr_.8fr_.8fr]">
            <div className="bg-[linear-gradient(135deg,#075BDB_0%,#1677FF_55%,#00AEEA_100%)] p-5 text-white">
              <div className="flex items-center gap-2 text-xs font-semibold text-cyan-100"><Crown className="h-4 w-4" />当前权益</div>
              <div className="mt-3 text-3xl font-bold">{payload.membership.tier === "free" ? "普通用户" : payload.membership.tier.toUpperCase()}</div>
              <p className="mt-2 text-xs leading-5 text-blue-50/80">累计有效充值 ¥{(payload.membership.paidCents / 100).toFixed(2)}</p>
            </div>
            <div className="bg-white p-5">
              <div className="text-xs text-[#6B8299]">子账号名额</div>
              <div className="mt-2 font-mono text-2xl font-bold text-[#0958D9]">{payload.used} / {payload.limit}</div>
              <p className="mt-2 text-[11px] text-[#7E91A7]">停用账号仍占用名额；解除关联会暂停登录并释放名额，后续可以恢复。</p>
            </div>
            <div className="flex items-center justify-between gap-3 bg-white p-5 md:block">
              <div>
                <div className="text-xs text-[#6B8299]">客户数据归属</div>
                <div className="mt-2 text-sm font-semibold">始终归主账号所有</div>
              </div>
              <button
                type="button"
                disabled={!canCreate || loading}
                onClick={() => setShowCreate(true)}
                className="mt-0 inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45 md:mt-4"
              >
                <Plus className="h-4 w-4" />创建子账号
              </button>
            </div>
          </div>
        </section>

        {notice ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <Check className="h-4 w-4" />{notice}
          </div>
        ) : null}

        {error ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <span>{error}</span>
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-xs font-semibold"><RefreshCw className="h-3.5 w-3.5" />重试</button>
          </div>
        ) : null}

        <section className="overflow-hidden rounded-lg border border-[#D5E3F1] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#E6EEF6] px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">已关联客户账号</h2>
              <p className="mt-0.5 text-[11px] text-[#7E91A7]">客户只能访问自己被授权的品牌、产品或个人 IP。</p>
            </div>
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-[#1677FF]" /> : null}
          </div>
          {!loading && payload.accounts.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <LockKeyhole className="mx-auto h-8 w-8 text-[#8FB5D8]" />
              <p className="mt-3 text-sm font-semibold">还没有客户子账号</p>
              <p className="mt-1 text-xs text-[#7E91A7]">VIP2 起可为现有客户面板创建专属登录账号。</p>
            </div>
          ) : (
            <div className="divide-y divide-[#EDF2F7]">
              {payload.accounts.map(account => (
                <article key={account.userId} className="grid gap-3 px-4 py-4 lg:grid-cols-[1.1fr_1fr_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{account.clientName}</h3>
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${account.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        {account.status === "active" ? "正常" : "已暂停"}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-[#6B8299]">{account.name} · {account.email}</p>
                  </div>
                  <div className="text-xs leading-5 text-[#6B8299]">
                    <div>权限：查看执行反馈，可按授权进行疑问句检测</div>
                    <div>可用积分：<span className="font-mono font-semibold text-[#0958D9]">{account.creditBalance}</span> · 由主账号按需分配</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {account.provisioning === "owner" ? (
                      <button type="button" disabled={Boolean(pending)} onClick={() => openTransfer(account)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#91CAFF] bg-[#F3F9FF] px-3 text-xs font-semibold text-[#0958D9] hover:bg-[#EAF4FF] disabled:opacity-45"><Coins className="h-4 w-4" />分配积分</button>
                    ) : null}
                    <button type="button" title="生成新的临时密码" disabled={Boolean(pending)} onClick={() => void accountAction(account, "reset")} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#CFE0F2] text-[#0958D9] hover:bg-[#EEF6FF] disabled:opacity-45"><KeyRound className="h-4 w-4" /></button>
                    <button type="button" title={account.status === "active" ? "暂停账号" : "恢复账号"} disabled={Boolean(pending)} onClick={() => void accountAction(account, "status")} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#CFE0F2] text-[#526A83] hover:bg-[#F3F7FB] disabled:opacity-45">{account.status === "active" ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}</button>
                    <button type="button" title="解除关联" disabled={Boolean(pending)} onClick={() => void accountAction(account, "remove")} className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-45"><Unlink className="h-4 w-4" /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {payload.detachedAccounts.length > 0 ? (
          <section className="overflow-hidden rounded-lg border border-amber-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50/70 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-amber-950">已解除客户账号</h2>
                <p className="mt-0.5 text-[11px] text-amber-700">账号、积分和历史记录仍保留，可恢复原来的客户面板关联。</p>
              </div>
              <span className="rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                {payload.detachedAccounts.length} 个
              </span>
            </div>
            <div className="divide-y divide-amber-100">
              {payload.detachedAccounts.map(account => (
                <article key={account.userId} className="grid gap-3 px-4 py-4 lg:grid-cols-[1.1fr_1fr_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#102A43]">{account.clientName}</div>
                    <p className="mt-1 truncate text-xs text-[#6B8299]">{account.name} · {account.email}</p>
                  </div>
                  <div className="text-xs leading-5 text-[#6B8299]">
                    <div>保留积分：<span className="font-mono font-semibold text-[#0958D9]">{account.creditBalance}</span></div>
                    <div className={account.canRestore ? "text-emerald-700" : "text-rose-600"}>
                      {account.canRestore ? "原客户面板可正常恢复" : account.unavailableReason}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(pending) || !account.canRestore}
                    onClick={() => void restoreAccount(account)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {pending === `restore:${account.userId}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    {pending === `restore:${account.userId}` ? "恢复中" : "一键恢复"}
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#00133F]/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="create-client-account-title">
          <form onSubmit={createAccount} className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-[#075BDB] to-[#00AEEA] px-5 py-4 text-white">
              <div><h2 id="create-client-account-title" className="text-base font-semibold">创建客户专属账号</h2><p className="mt-1 text-[11px] text-blue-50/80">创建后临时密码只展示一次</p></div>
              <button type="button" onClick={() => setShowCreate(false)} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/12" aria-label="关闭"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-[#526A83]">关联客户面板</span><select name="clientId" required className="h-11 w-full rounded-lg border border-[#CFE0F2] bg-white px-3 text-sm outline-none focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15"><option value="">请选择</option>{availableClients.map(client => <option key={client.id} value={client.id}>{client.name}{client.industry ? ` · ${client.industry}` : ""}</option>)}</select></label>
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-[#526A83]">客户邮箱</span><input name="email" type="email" required placeholder="client@example.com" className="h-11 w-full rounded-lg border border-[#CFE0F2] px-3 text-sm outline-none focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15" /></label>
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-[#526A83]">客户称呼</span><input name="name" placeholder="例如：张总" className="h-11 w-full rounded-lg border border-[#CFE0F2] px-3 text-sm outline-none focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15" /></label>
              <div className="rounded-lg bg-[#EEF6FF] px-3 py-2.5 text-xs leading-5 text-[#0958D9]">客户首次登录后需要通过邮箱验证码设置自己的密码。主账号不能查看客户后续修改的密码。</div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#E6EEF6] px-5 py-4"><button type="button" onClick={() => setShowCreate(false)} className="h-10 rounded-lg px-4 text-xs font-semibold text-[#526A83] hover:bg-[#F3F7FB]">取消</button><button type="submit" disabled={pending === "create" || availableClients.length === 0} className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white disabled:opacity-50">{pending === "create" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}创建并生成密码</button></div>
          </form>
        </div>
      ) : null}

      {transferTarget ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#00133F]/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="transfer-credits-title">
          <div className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-[#075BDB] to-[#00AEEA] px-5 py-4 text-white">
              <div><h2 id="transfer-credits-title" className="text-base font-semibold">向客户账号分配积分</h2><p className="mt-1 text-[11px] text-blue-50/80">{transferTarget.clientName} · 当前 {transferTarget.creditBalance} 积分</p></div>
              <button type="button" onClick={() => setTransferTarget(null)} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/12" aria-label="关闭"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-[#526A83]">分配数量</span><input type="number" min="1" max="100000" step="1" value={transferAmount} onChange={event => setTransferAmount(event.target.value)} className="h-11 w-full rounded-lg border border-[#CFE0F2] px-3 font-mono text-sm outline-none focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15" /></label>
              <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800 ring-1 ring-amber-200">积分会从当前主账号余额中扣除并转入客户账号，双方账单都会留下可核对记录。</div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#E6EEF6] px-5 py-4"><button type="button" onClick={() => setTransferTarget(null)} className="h-10 rounded-lg px-4 text-xs font-semibold text-[#526A83] hover:bg-[#F3F7FB]">取消</button><button type="button" onClick={() => void transferCredits()} disabled={pending.startsWith("credits:")} className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white disabled:opacity-50">{pending.startsWith("credits:") ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}确认分配</button></div>
          </div>
        </div>
      ) : null}

      {credential ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#00133F]/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="credential-title">
          <div className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="bg-gradient-to-r from-[#075BDB] to-[#00AEEA] px-5 py-4 text-white"><div className="flex items-center gap-2 text-xs text-cyan-100"><Check className="h-4 w-4" />账号凭证已生成</div><h2 id="credential-title" className="mt-2 text-lg font-semibold">请现在交给客户</h2></div>
            <div className="space-y-3 px-5 py-5"><div className="rounded-lg border border-[#D5E3F1] bg-[#F7FAFD] px-3 py-3"><div className="text-[10px] text-[#7E91A7]">登录邮箱</div><div className="mt-1 break-all font-mono text-sm font-semibold">{credential.email}</div></div><div className="rounded-lg border border-[#91CAFF] bg-[#EEF6FF] px-3 py-3"><div className="text-[10px] text-[#5B7592]">临时密码</div><div className="mt-1 break-all font-mono text-base font-bold text-[#003EB3]">{credential.temporaryPassword}</div></div><p className="text-xs leading-5 text-amber-700">关闭后系统不会再次显示这个密码。忘记时可以重新生成，旧登录状态会失效。</p></div>
            <div className="flex gap-2 border-t border-[#E6EEF6] px-5 py-4"><button type="button" onClick={() => void copyCredential()} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] text-xs font-semibold text-white">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "已复制" : "复制账号与密码"}</button><button type="button" onClick={() => setCredential(null)} className="h-10 rounded-lg border border-[#CFE0F2] px-4 text-xs font-semibold">完成</button></div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
