import { assertAdmin } from "@/lib/admin"
import { listUsers } from "@/lib/auth"
import { listAllCreditLedger, type CreditLedgerEntry } from "@/lib/credit-ledger"
import { getFeaturePrice } from "@/lib/pricing"

export const dynamic = "force-dynamic"

const TYPE_LABEL: Record<CreditLedgerEntry["type"], string> = {
  trial_grant: "试用赠送",
  bootstrap_grant: "历史补足",
  recharge_requested: "充值申请",
  recharge_approved: "充值到账",
  recharge_rejected: "充值拒绝",
  admin_adjust: "管理员调整",
  usage_reserved: "功能扣费",
  usage_refund: "积分退回",
  usage_extra: "超额结算",
  client_monthly_grant: "客户月度额度",
  client_monthly_adjust: "客户额度调整",
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false })
}

function entryLabel(entry: CreditLedgerEntry): string {
  if (entry.description) return entry.description
  if (entry.featureKey) return getFeaturePrice(entry.featureKey).label
  return TYPE_LABEL[entry.type] || "积分变动"
}

export async function GET() {
  try {
    await assertAdmin()
  } catch {
    return new Response("Forbidden", { status: 403 })
  }

  const [entries, users] = await Promise.all([
    listAllCreditLedger(10000),
    listUsers(),
  ])
  const userMap = new Map(users.map(user => [user.id, user]))
  const rows = [
    ["流水ID", "时间", "用户ID", "用户", "邮箱", "类型", "说明", "变动", "余额", "来源", "来源ID", "操作人", "计费版本", "元数据"],
    ...entries.map(entry => {
      const user = userMap.get(entry.userId)
      return [
        entry.id,
        formatTime(entry.createdAt),
        entry.userId,
        user?.name || "",
        user?.email || "",
        TYPE_LABEL[entry.type],
        entryLabel(entry),
        entry.delta,
        typeof entry.balanceAfter === "number" ? entry.balanceAfter : "",
        entry.source || "",
        entry.sourceId || "",
        entry.operatorUserId || "",
        entry.pricingVersion,
        entry.metadata ? JSON.stringify(entry.metadata) : "",
      ]
    }),
  ]
  const body = `\uFEFF${rows.map(row => row.map(csvCell).join(",")).join("\n")}`
  const filename = `credit-ledger-${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  })
}
