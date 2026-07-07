import { assertAdmin } from "@/lib/admin"
import { formatYuan } from "@/lib/pricing"
import { listAllRequests, type RechargeRequest } from "@/lib/recharge"

export const dynamic = "force-dynamic"

const STATUS_LABEL: Record<RechargeRequest["status"], string> = {
  pending: "待审批",
  approved: "已到账",
  rejected: "已拒绝",
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function formatTime(value?: number): string {
  if (!value) return ""
  return new Date(value).toLocaleString("zh-CN", { hour12: false })
}

export async function GET() {
  try {
    await assertAdmin()
  } catch {
    return new Response("Forbidden", { status: 403 })
  }

  const records = await listAllRequests(5000)
  const rows = [
    [
      "申请ID",
      "用户ID",
      "用户",
      "邮箱",
      "套餐",
      "金额",
      "积分",
      "付款方式",
      "付款人",
      "付款凭证",
      "联系方式",
      "状态",
      "提交时间",
      "处理时间",
      "处理人",
      "备注",
    ],
    ...records.map(record => [
      record.id,
      record.userId,
      record.username,
      record.email,
      record.packageName || "历史充值申请",
      record.priceCents ? formatYuan(record.priceCents) : "",
      record.credits ?? record.amount,
      record.paymentMethod || "manual_transfer",
      record.payerName || "",
      record.paymentReference || "",
      record.contact || "",
      STATUS_LABEL[record.status],
      formatTime(record.createdAt),
      formatTime(record.processedAt),
      record.processedBy || "",
      record.note || "",
    ]),
  ]
  const body = `\uFEFF${rows.map(row => row.map(csvCell).join(",")).join("\n")}`
  const filename = `recharge-records-${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  })
}
