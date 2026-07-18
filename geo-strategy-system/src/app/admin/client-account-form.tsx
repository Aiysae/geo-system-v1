"use client"

import { useActionState } from "react"
import { Link2, LockKeyhole, PauseCircle, PlayCircle, Unlink } from "lucide-react"
import {
  saveClientAccountLinkAction,
  unlinkClientAccountAction,
  updateClientAccountStatusAction,
  type ClientAccountActionState,
} from "./actions"

type ClientOption = {
  value: string
  clientName: string
  industry: string
  ownerName: string
  ownerEmail: string
}

type CurrentLink = {
  ownerUserId: string
  clientId: string
  clientName: string
  monthlyCredits: number
  status: "active" | "suspended"
}

const initialState: ClientAccountActionState = {}

function ResultMessage({ state }: { state: ClientAccountActionState }) {
  if (!state.message) return null
  return (
    <p className={`text-xs ${state.ok ? "text-emerald-600" : "text-rose-600"}`}>
      {state.message}
    </p>
  )
}

export function ClientAccountForm({
  userId,
  options,
  currentLink,
  disabled = false,
}: {
  userId: string
  options: ClientOption[]
  currentLink: CurrentLink | null
  disabled?: boolean
}) {
  const [saveState, saveAction, savePending] = useActionState(
    saveClientAccountLinkAction,
    initialState,
  )
  const [statusState, statusAction, statusPending] = useActionState(
    updateClientAccountStatusAction,
    initialState,
  )
  const [unlinkState, unlinkAction, unlinkPending] = useActionState(
    unlinkClientAccountAction,
    initialState,
  )
  const currentSelection = currentLink
    ? `${currentLink.ownerUserId}::${currentLink.clientId}`
    : ""

  if (disabled) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-500">
        管理员账号不能转换为客户专属账号。
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border border-[#B7DBFF] bg-[#F2F8FF] p-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00AEEA] text-white shadow-sm">
            <LockKeyhole className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-[#102A43]">
              {currentLink ? "已启用客户专属模式" : "尚未启用客户专属模式"}
            </div>
            <p className="mt-1 text-xs leading-5 text-[#526A83]">
              专属账号只能访问一个授权品牌；可编辑疑问句并运行渗透率检测，其他模块仅查看。
            </p>
          </div>
        </div>
        {currentLink ? (
          <div className="rounded-lg bg-white px-3 py-2.5 text-xs ring-1 ring-[#CFE5FA]">
            <div className="font-semibold text-[#102A43]">{currentLink.clientName}</div>
            <div className="mt-1 text-[#6B8299]">
              状态：{currentLink.status === "active" ? "正常使用" : "已暂停"}
            </div>
            <div className="mt-1 text-[#6B8299]">
              每月额度：{currentLink.monthlyCredits} 积分
            </div>
          </div>
        ) : null}
      </div>

      <form action={saveAction} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto] lg:items-end">
        <input type="hidden" name="userId" value={userId} />
        <label className="block min-w-0">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">关联客户面板</span>
          <select
            name="clientSelection"
            required
            defaultValue={currentSelection}
            disabled={savePending || options.length === 0}
            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15 disabled:bg-slate-50"
          >
            <option value="" disabled>选择一个现有客户面板</option>
            {options.map(option => (
              <option key={option.value} value={option.value}>
                {option.clientName}{option.industry ? ` · ${option.industry}` : ""}（{option.ownerName} / {option.ownerEmail}）
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">每月专属额度</span>
          <div className="relative">
            <input
              name="monthlyCredits"
              type="number"
              min={1}
              max={1000000}
              step={1}
              required
              defaultValue={currentLink?.monthlyCredits || 1000}
              disabled={savePending}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 pr-12 text-sm font-mono text-slate-800 outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
              积分
            </span>
          </div>
        </label>
        <button
          type="submit"
          disabled={savePending || options.length === 0}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-55"
        >
          <Link2 className="h-3.5 w-3.5" />
          {savePending ? "保存中" : currentLink ? "更新授权" : "确认授权"}
        </button>
      </form>
      {options.length === 0 ? (
        <p className="text-xs text-amber-700">
          当前系统还没有可关联的客户面板，请先由管理员或业务账号创建客户。
        </p>
      ) : null}
      <ResultMessage state={saveState} />

      {currentLink ? (
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <form action={statusAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="userId" value={userId} />
            <input
              type="hidden"
              name="status"
              value={currentLink.status === "active" ? "suspended" : "active"}
            />
            <button
              type="submit"
              disabled={statusPending}
              className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold ring-1 transition disabled:opacity-55 ${
                currentLink.status === "active"
                  ? "bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100"
                  : "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100"
              }`}
            >
              {currentLink.status === "active"
                ? <PauseCircle className="h-3.5 w-3.5" />
                : <PlayCircle className="h-3.5 w-3.5" />}
              {statusPending
                ? "处理中"
                : currentLink.status === "active" ? "暂停专属账号" : "恢复专属账号"}
            </button>
            <ResultMessage state={statusState} />
          </form>

          <form action={unlinkAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="userId" value={userId} />
            <button
              type="submit"
              disabled={unlinkPending}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-rose-50 px-3 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 disabled:opacity-55"
            >
              <Unlink className="h-3.5 w-3.5" />
              {unlinkPending ? "解除中" : "解除客户授权"}
            </button>
            <ResultMessage state={unlinkState} />
          </form>
        </div>
      ) : null}
    </div>
  )
}
