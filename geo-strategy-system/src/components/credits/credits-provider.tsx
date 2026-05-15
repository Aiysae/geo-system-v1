"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { useAuth } from "@clerk/nextjs"
import { Sparkles, X } from "lucide-react"
import { registerCreditsHandlers, unregisterCreditsHandlers } from "@/lib/api-fetch"

type CreditsContextValue = {
  balance: number | null
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
  const { isSignedIn } = useAuth()
  const [balance, setBalance] = useState<number | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  // 避免短时间内多次成功触发并发 refresh
  const refreshingRef = useRef(false)

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    try {
      const res = await fetch("/api/credits", { cache: "no-store" })
      if (res.ok) {
        const data = await res.json()
        if (typeof data?.credits === "number") setBalance(data.credits)
      }
    } catch {
      /* 静默 */
    } finally {
      refreshingRef.current = false
    }
  }, [])

  // 登录态变化时初始化/清空
  useEffect(() => {
    if (!isSignedIn) return

    queueMicrotask(() => {
      void refresh()
    })
  }, [isSignedIn, refresh])

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
    <CreditsContext.Provider value={{ balance, refresh }}>
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
        className="relative w-[90%] max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
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
            <span className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center shadow-lg shadow-rose-200/50">
              <Sparkles className="h-5 w-5 text-white" />
            </span>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">
              体验算力积分不足
            </h2>
          </div>

          <p className="text-sm text-slate-600 leading-relaxed">
            您的体验算力积分已耗尽。请联系管理员进行充值。
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

          <button
            onClick={onClose}
            className="mt-6 w-full py-2.5 rounded-xl bg-gradient-to-r from-[#004B73] to-[#0077B6] text-white text-sm font-medium hover:shadow-lg hover:shadow-blue-300/40 hover:-translate-y-0.5 transition-all"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  )
}
