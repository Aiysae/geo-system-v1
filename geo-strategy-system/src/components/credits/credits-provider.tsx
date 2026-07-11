"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { Sparkles, X } from "lucide-react"
import { registerCreditsHandlers, unregisterCreditsHandlers } from "@/lib/api-fetch"
import { BillingLink } from "@/components/billing/billing-link"

type CreditsContextValue = {
  balance: number | null
  unlimited: boolean
  refresh: () => Promise<void>
}

const CreditsContext = createContext<CreditsContextValue | null>(null)

export function useCredits() {
  const ctx = useContext(CreditsContext)
  if (!ctx) throw new Error("useCredits must be used inside CreditsProvider")
  return ctx
}

type ModalState = { required?: number; balance?: number } | null

export function CreditsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const creditsEnabled = pathname === "/workspace"
    || pathname.startsWith("/workspace/")
    || pathname === "/billing"
    || pathname.startsWith("/admin")
  const [balance, setBalance] = useState<number | null>(null)
  const [unlimited, setUnlimited] = useState(false)
  const [modal, setModal] = useState<ModalState>(null)
  // 避免短时间内多次成功触发并发 refresh
  const refreshingRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!creditsEnabled) return
    if (refreshingRef.current) return
    refreshingRef.current = true
    try {
      const res = await fetch("/api/credits", { cache: "no-store" })
      if (res.ok) {
        const data = await res.json()
        if (typeof data?.credits === "number") setBalance(data.credits)
        setUnlimited(data?.unlimited === true)
      } else if (res.status === 401) {
        setBalance(null)
        setUnlimited(false)
      }
    } catch {
      /* 静默 */
    } finally {
      refreshingRef.current = false
    }
  }, [creditsEnabled])

  useEffect(() => {
    if (!creditsEnabled) return
    const initialRefresh = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => void refresh(), 30_000)
    const onFocus = () => void refresh()
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    const onCreditsRefresh = () => void refresh()
    window.addEventListener("focus", onFocus)
    window.addEventListener("credits:refresh", onCreditsRefresh)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(timer)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("credits:refresh", onCreditsRefresh)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [creditsEnabled, refresh])

  // 注册 fetch 桥接回调
  useEffect(() => {
    registerCreditsHandlers({
      onInsufficient: info => {
        setModal({ required: info.required, balance: info.balance })
        if (typeof info.balance === "number") setBalance(info.balance)
      },
      onSuccess: () => {
        refresh()
      },
    })
    return () => unregisterCreditsHandlers()
  }, [refresh])

  return (
    <CreditsContext.Provider value={{ balance, unlimited, refresh }}>
      {children}
      {modal && (
        <InsufficientCreditsModal
          required={modal.required}
          balance={modal.balance}
          onClose={() => setModal(null)}
        />
      )}
    </CreditsContext.Provider>
  )
}

function InsufficientCreditsModal({
  required,
  balance,
  onClose,
}: {
  required?: number
  balance?: number
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-[90%] max-w-md rounded-lg bg-white shadow-2xl ring-1 ring-slate-200"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-slate-100 transition"
          aria-label="关闭"
        >
          <X className="h-4 w-4 text-slate-500" />
        </button>

        <div className="px-7 pt-7 pb-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#C79A3B] shadow-sm">
              <Sparkles className="h-5 w-5 text-white" />
            </span>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">
              体验算力积分不足
            </h2>
          </div>

          <p className="text-sm text-slate-600 leading-relaxed">
            当前体验算力积分不足以完成本次任务。你可以选择充值套餐，或减少问题数量 / 检测模型后重试。
          </p>

          {(typeof required === "number" || typeof balance === "number") && (
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              {typeof required === "number" && (
                <div className="rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
                  <div className="text-slate-400 mb-0.5">本次需要</div>
                  <div className="font-mono text-slate-900 font-semibold">{required} 积分</div>
                </div>
              )}
              {typeof balance === "number" && (
                <div className="rounded-lg bg-rose-50 px-3 py-2.5 ring-1 ring-rose-200">
                  <div className="text-rose-400 mb-0.5">当前余额</div>
                  <div className="font-mono text-rose-700 font-semibold">{balance} 积分</div>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl bg-white py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
            >
              我知道了
            </button>
            <BillingLink
              onNavigate={onClose}
              className="flex-1 rounded-lg bg-[#087F9C] py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-[#066B83]"
            >
              去充值
            </BillingLink>
          </div>
        </div>
      </div>
    </div>
  )
}
