"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import {
  Check,
  Coins,
  Copy,
  KeyRound,
  Loader2,
  LockKeyhole,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  Save,
  ShieldCheck,
  Unlink,
  UserPlus,
  X,
} from "lucide-react"
import { toUserFacingError } from "@/lib/user-facing-errors"
import type { MembershipSnapshot } from "@/types"
import type { TeamPermissionKey } from "@/lib/team-permissions"
import type { ClientPenetrationResultDetail } from "@/lib/client-account-policy"

type ManagedAccount = {
  userId: string
  email: string
  name: string
  clientName: string
  status: "active" | "suspended"
  sourceStatus: "active" | "revoked"
  provisioning: "admin" | "owner"
  permissionKeys: TeamPermissionKey[]
  penetrationResultDetail: ClientPenetrationResultDetail
  creditBalance: number
}

type DetachedAccount = {
  userId: string
  email: string
  name: string
  clientName: string
  creditBalance: number
  canRestore: boolean
  unavailableReason: string
}

type AccountPayload = {
  membership: MembershipSnapshot
  used: number
  limit: number
  canTransferCredits: boolean
  accounts: ManagedAccount[]
  detachedAccounts: DetachedAccount[]
}

type Credential = {
  email: string
  temporaryPassword: string
}

type PermissionDraft = {
  feedbackView: boolean
  penetrationView: boolean
  penetrationExecute: boolean
  penetrationResultDetail: ClientPenetrationResultDetail
}

function permissionDraftFromAccount(
  account: ManagedAccount | undefined,
): PermissionDraft | null {
  if (!account) return null
  return {
    feedbackView: account.permissionKeys.includes("feedback.view"),
    penetrationView: account.permissionKeys.includes("penetration.view"),
    penetrationExecute: account.permissionKeys.includes("penetration.execute"),
    penetrationResultDetail: account.penetrationResultDetail,
  }
}

export function ClientAccountDialog({
  clientRef,
  clientName,
  onClose,
  onChanged,
}: {
  clientRef: string
  clientName: string
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const [payload, setPayload] = useState<AccountPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [credential, setCredential] = useState<Credential | null>(null)
  const [transferAmount, setTransferAmount] = useState("100")
  const [showTransfer, setShowTransfer] = useState(false)
  const [permissionDraft, setPermissionDraft] = useState<PermissionDraft | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(
        `/api/client-accounts?clientRef=${encodeURIComponent(clientRef)}`,
        { cache: "no-store" },
      )
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || "客户账号读取失败")
      const nextPayload = body as AccountPayload
      setPayload(nextPayload)
      setPermissionDraft(permissionDraftFromAccount(nextPayload.accounts[0]))
    } catch (loadError) {
      setError(toUserFacingError(loadError, {
        fallback: "客户账号读取失败，请稍后重试。",
        subject: "客户账号",
      }))
    } finally {
      setLoading(false)
    }
  }, [clientRef])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function refreshAfterChange(notice: string) {
    setMessage(notice)
    await Promise.all([load(), onChanged()])
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending("create")
    setError("")
    try {
      const response = await fetch("/api/client-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRef,
          email: String(form.get("email") || ""),
          name: String(form.get("name") || ""),
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || "客户子账号创建失败")
      setCredential({
        email: body.account.email,
        temporaryPassword: body.temporaryPassword,
      })
      await refreshAfterChange("客户专属账号已创建")
    } catch (createError) {
      setError(toUserFacingError(createError, {
        fallback: "客户子账号创建失败，请稍后重试。",
        subject: "创建客户账号",
      }))
    } finally {
      setPending("")
    }
  }

  async function accountAction(
    account: ManagedAccount,
    action: "status" | "reset" | "remove",
  ) {
    if (action === "remove" && !window.confirm(
      `确认解除“${account.clientName}”的客户账号关联吗？账号和积分会保留，可稍后恢复。`,
    )) return
    setPending(action)
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
              : {
                  action: "status",
                  status: account.status === "active" ? "suspended" : "active",
                }),
          })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || "客户账号操作失败")
      if (action === "reset") {
        setCredential({ email: body.email, temporaryPassword: body.temporaryPassword })
      }
      await refreshAfterChange(action === "remove" ? "关联已解除" : "客户账号已更新")
    } catch (actionError) {
      setError(toUserFacingError(actionError, {
        fallback: "客户账号操作失败，请稍后重试。",
        subject: "客户账号",
      }))
    } finally {
      setPending("")
    }
  }

  async function restoreAccount(account: DetachedAccount) {
    setPending("restore")
    setError("")
    try {
      const response = await fetch(
        `/api/client-accounts/${encodeURIComponent(account.userId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore" }),
        },
      )
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || "客户账号恢复失败")
      await refreshAfterChange("客户账号已恢复，可以重新登录")
    } catch (restoreError) {
      setError(toUserFacingError(restoreError, {
        fallback: "客户账号恢复失败，请稍后重试。",
        subject: "恢复客户账号",
      }))
    } finally {
      setPending("")
    }
  }

  async function transferCredits(account: ManagedAccount) {
    const amount = Math.floor(Number(transferAmount))
    if (!Number.isFinite(amount) || amount < 1) {
      setError("请输入正确的积分数量")
      return
    }
    setPending("credits")
    setError("")
    try {
      const response = await fetch(
        `/api/client-accounts/${encodeURIComponent(account.userId)}/credits`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operationId: `ct_${crypto.randomUUID().replace(/-/g, "")}`,
            amount,
          }),
        },
      )
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || "积分分配失败")
      setShowTransfer(false)
      await refreshAfterChange(`已分配 ${amount} 积分`)
    } catch (transferError) {
      setError(toUserFacingError(transferError, {
        fallback: "积分分配失败，请稍后重试。",
        subject: "积分分配",
      }))
    } finally {
      setPending("")
    }
  }

  async function savePermissions(account: ManagedAccount) {
    if (!permissionDraft) return
    const permissionKeys: TeamPermissionKey[] = ["client.view"]
    if (permissionDraft.feedbackView) permissionKeys.push("feedback.view")
    if (permissionDraft.penetrationView || permissionDraft.penetrationExecute) {
      permissionKeys.push("penetration.view")
    }
    if (permissionDraft.penetrationExecute) {
      permissionKeys.push("penetration.execute", "penetration.edit")
    }
    setPending("permissions")
    setError("")
    try {
      const response = await fetch(
        `/api/client-accounts/${encodeURIComponent(account.userId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "permissions",
            permissionKeys,
            penetrationResultDetail: permissionDraft.penetrationResultDetail,
          }),
        },
      )
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || "客户权限保存失败")
      await refreshAfterChange("客户可见权限已保存")
    } catch (permissionError) {
      setError(toUserFacingError(permissionError, {
        fallback: "客户权限保存失败，请稍后重试。",
        subject: "客户权限",
      }))
    } finally {
      setPending("")
    }
  }

  async function copyCredential() {
    if (!credential) return
    await navigator.clipboard.writeText(
      `势途 GEO 客户专属账号\n登录邮箱：${credential.email}\n临时密码：${credential.temporaryPassword}\n登录地址：${window.location.origin}/sign-in`,
    )
    setMessage("账号和临时密码已复制")
  }

  const account = payload?.accounts[0]
  const detached = payload?.detachedAccounts[0]
  const canCreate = Boolean(
    payload
    && payload.limit > payload.used
    && !account
    && !detached,
  )

  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-[#001D66]/55 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="client-account-dialog-title">
      <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:max-w-2xl sm:rounded-lg">
        <header className="flex items-center justify-between gap-4 bg-gradient-to-r from-[#075BDB] via-[#1677FF] to-[#00AEEA] px-5 py-4 text-white">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold text-cyan-100">客户专属账号</div>
            <h2 id="client-account-dialog-title" className="mt-1 truncate text-base font-semibold">{clientName}</h2>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 transition hover:bg-white/20" aria-label="关闭客户账号管理">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
          {loading ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-[#1677FF]" />正在读取账号状态
            </div>
          ) : null}

          {error ? (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-700">{error}</div>
          ) : null}
          {message ? (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">
              <Check className="h-4 w-4" />{message}
            </div>
          ) : null}

          {!loading && payload ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 text-xs">
                <div className="text-slate-500">
                  当前权益 <span className="font-semibold text-[#0958D9]">{payload.membership.tier === "free" ? "普通用户" : payload.membership.tier.toUpperCase()}</span>
                </div>
                <div className="font-mono text-slate-500">子账号 {payload.used} / {payload.limit}</div>
              </div>

              {account ? (
                <section>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-slate-900">{account.name}</h3>
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                          account.sourceStatus === "revoked"
                            ? "bg-rose-50 text-rose-700"
                            : account.status === "active"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700"
                        }`}>
                          {account.sourceStatus === "revoked"
                            ? "来源授权失效"
                            : account.status === "active" ? "正常" : "已暂停"}
                        </span>
                      </div>
                      <p className="mt-1 break-all text-xs text-slate-500">{account.email}</p>
                      <p className="mt-2 text-xs text-slate-500">可用积分 <span className="font-mono font-semibold text-[#0958D9]">{account.creditBalance}</span></p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {payload.canTransferCredits && account.provisioning === "owner" ? (
                        <button type="button" onClick={() => setShowTransfer(value => !value)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#91CAFF] bg-[#F3F9FF] px-3 text-xs font-semibold text-[#0958D9]">
                          <Coins className="h-4 w-4" />分配积分
                        </button>
                      ) : null}
                      <button type="button" disabled={Boolean(pending)} onClick={() => void accountAction(account, "reset")} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-[#0958D9] disabled:opacity-50" title="重置临时密码"><KeyRound className="h-4 w-4" /></button>
                      <button type="button" disabled={Boolean(pending) || account.sourceStatus === "revoked"} onClick={() => void accountAction(account, "status")} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-50" title={account.status === "active" ? "暂停账号" : "恢复账号"}>
                        {account.status === "active" ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                      </button>
                      <button type="button" disabled={Boolean(pending)} onClick={() => void accountAction(account, "remove")} className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 text-rose-600 disabled:opacity-50" title="解除关联"><Unlink className="h-4 w-4" /></button>
                    </div>
                  </div>
                  {showTransfer && payload.canTransferCredits ? (
                    <div className="mt-4 flex flex-col gap-2 rounded-lg bg-[#F3F9FF] p-3 sm:flex-row">
                      <input type="number" min="1" max="100000" value={transferAmount} onChange={event => setTransferAmount(event.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border border-[#B7DBFF] bg-white px-3 text-sm outline-none focus:border-[#1677FF]" />
                      <button type="button" disabled={pending === "credits"} onClick={() => void transferCredits(account)} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-[#1677FF] px-4 text-xs font-semibold text-white disabled:opacity-50">
                        {pending === "credits" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}确认分配
                      </button>
                    </div>
                  ) : null}
                  {permissionDraft ? (
                    <div className="mt-4 rounded-lg border border-[#D8E8F8] bg-[#F8FBFF] p-4">
                      <div className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#1677FF]" />
                        <div>
                          <h4 className="text-xs font-semibold text-slate-900">客户可见权限</h4>
                          <p className="mt-1 text-[11px] leading-5 text-slate-500">
                            权限由服务端校验，关闭后客户即使保留原链接也无法读取对应内容。
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-white bg-white p-3 shadow-sm">
                          <input
                            type="checkbox"
                            checked={permissionDraft.feedbackView}
                            onChange={event => setPermissionDraft(current => current ? {
                              ...current,
                              feedbackView: event.target.checked,
                            } : current)}
                            className="mt-0.5 h-4 w-4 accent-[#1677FF]"
                          />
                          <span>
                            <span className="block text-xs font-semibold text-slate-800">执行日历</span>
                            <span className="mt-1 block text-[10px] leading-4 text-slate-500">查看公开动作、周报和月报</span>
                          </span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-white bg-white p-3 shadow-sm">
                          <input
                            type="checkbox"
                            checked={permissionDraft.penetrationView}
                            onChange={event => setPermissionDraft(current => current ? {
                              ...current,
                              penetrationView: event.target.checked,
                              penetrationExecute: event.target.checked
                                ? current.penetrationExecute
                                : false,
                            } : current)}
                            className="mt-0.5 h-4 w-4 accent-[#1677FF]"
                          />
                          <span>
                            <span className="block text-xs font-semibold text-slate-800">检测报告</span>
                            <span className="mt-1 block text-[10px] leading-4 text-slate-500">查看已向客户公开的检测结果</span>
                          </span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-white bg-white p-3 shadow-sm">
                          <input
                            type="checkbox"
                            checked={permissionDraft.penetrationExecute}
                            onChange={event => setPermissionDraft(current => current ? {
                              ...current,
                              penetrationExecute: event.target.checked,
                              penetrationView: event.target.checked
                                ? true
                                : current.penetrationView,
                            } : current)}
                            className="mt-0.5 h-4 w-4 accent-[#1677FF]"
                          />
                          <span>
                            <span className="block text-xs font-semibold text-slate-800">自主检测</span>
                            <span className="mt-1 block text-[10px] leading-4 text-slate-500">允许修改疑问句并发起检测</span>
                          </span>
                        </label>
                      </div>
                      <label className="mt-3 block text-[11px] font-semibold text-slate-700">
                        检测报告内容范围
                        <select
                          value={permissionDraft.penetrationResultDetail}
                          disabled={!permissionDraft.penetrationView}
                          onChange={event => setPermissionDraft(current => current ? {
                            ...current,
                            penetrationResultDetail: event.target.value === "summary"
                              ? "summary"
                              : "full",
                          } : current)}
                          className="mt-1.5 h-9 w-full rounded-lg border border-[#C8D9E8] bg-white px-3 text-xs font-normal outline-none focus:border-[#1677FF] disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          <option value="full">完整报告（含原始回答与信源）</option>
                          <option value="summary">数据概览（不含原始回答与信源）</option>
                        </select>
                      </label>
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          disabled={pending === "permissions"}
                          onClick={() => void savePermissions(account)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#1677FF] px-3 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {pending === "permissions"
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Save className="h-4 w-4" />}
                          保存权限
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : detached ? (
                <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <LockKeyhole className="h-4 w-4 text-amber-600" />已解除的客户账号
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{detached.email} · 保留 {detached.creditBalance} 积分</p>
                    {!detached.canRestore ? <p className="mt-2 text-xs text-rose-600">{detached.unavailableReason}</p> : null}
                  </div>
                  <button type="button" disabled={Boolean(pending) || !detached.canRestore} onClick={() => void restoreAccount(detached)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 disabled:opacity-50">
                    {pending === "restore" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}恢复账号
                  </button>
                </section>
              ) : (
                <form onSubmit={createAccount} className="space-y-4">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><UserPlus className="h-4 w-4 text-[#1677FF]" />创建该客户的专属登录账号</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">账号只会看到当前客户面板，首次登录后需通过邮箱验证码设置自己的密码。</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs font-medium text-slate-600">客户邮箱
                      <input name="email" type="email" required placeholder="client@example.com" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#1677FF] focus:ring-2 focus:ring-blue-100" />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">客户称呼
                      <input name="name" placeholder="例如：张总" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#1677FF] focus:ring-2 focus:ring-blue-100" />
                    </label>
                  </div>
                  <button type="submit" disabled={!canCreate || pending === "create"} className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                    {pending === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    {payload.limit === 0 ? "VIP2 起可创建" : payload.used >= payload.limit ? "子账号名额已满" : "创建并生成临时密码"}
                  </button>
                </form>
              )}
            </div>
          ) : null}
        </div>

        {credential ? (
          <footer className="border-t border-blue-100 bg-[#F3F9FF] px-4 py-4 sm:px-5">
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-blue-100"><span className="text-slate-400">登录邮箱</span><div className="mt-1 break-all font-mono font-semibold">{credential.email}</div></div>
              <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-blue-200"><span className="text-slate-400">临时密码</span><div className="mt-1 break-all font-mono font-bold text-[#0958D9]">{credential.temporaryPassword}</div></div>
            </div>
            <button type="button" onClick={() => void copyCredential()} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#1677FF] px-3 text-xs font-semibold text-white"><Copy className="h-4 w-4" />复制账号和密码</button>
          </footer>
        ) : null}
      </div>
    </div>
  )
}
