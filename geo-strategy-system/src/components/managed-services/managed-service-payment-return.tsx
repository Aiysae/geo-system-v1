"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"

export function ManagedServicePaymentReturn() {
  const params = useSearchParams()
  const router = useRouter()
  const hasPaymentReturn = (params.get("payment_return") === "alipay" || params.get("payment_return") === "wechat")
    && Boolean(params.get("order_id"))
    && Boolean(params.get("service_order_id"))
  const [message, setMessage] = useState(
    hasPaymentReturn ? "正在确认支付结果并创建专属项目..." : "",
  )

  useEffect(() => {
    const provider = params.get("payment_return")
    const orderId = params.get("order_id")
    const serviceOrderId = params.get("service_order_id")
    if ((provider !== "alipay" && provider !== "wechat") || !orderId || !serviceOrderId) return
    fetch(`/api/recharge/payments/${provider}/${encodeURIComponent(orderId)}/sync`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async response => ({ ok: response.ok, payload: await response.json() as { status?: string } }))
      .then(({ ok, payload }) => {
        if (!ok) throw new Error("支付状态查询失败")
        if (payload.status === "credited") {
          router.replace(`/account/services/${encodeURIComponent(serviceOrderId)}`)
          router.refresh()
        } else {
          setMessage("支付结果仍在确认中，可稍后刷新订单状态。")
        }
      })
      .catch(() => setMessage("暂未确认到账，请稍后在代运营项目中刷新。"))
  }, [params, router])

  if (!message) return null
  return <div role="status" className="mb-4 flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-3 text-xs font-semibold text-[#0958D9] ring-1 ring-blue-200"><Loader2 className="h-4 w-4 animate-spin" />{message}</div>
}
