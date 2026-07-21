import "server-only"

import { kv } from "@/lib/kv"
import { adjustCreditsByAdmin, getCreditBalanceSnapshot } from "@/lib/credits"

type TransferState = {
  version: 1
  operationId: string
  ownerUserId: string
  childUserId: string
  amount: number
  status: "pending" | "debited" | "completed" | "failed"
  sourceBalance?: number
  targetBalance?: number
  error?: string
  createdAt: string
  updatedAt: string
}

const key = (operationId: string) => `client_credit_transfer:${operationId}`
const TTL_SECONDS = 60 * 60 * 24 * 30

function validate(input: {
  operationId: string
  ownerUserId: string
  childUserId: string
  amount: number
}) {
  const operationId = input.operationId.trim()
  if (!/^ct_[a-zA-Z0-9_-]{16,120}$/.test(operationId)) throw new Error("积分分配操作号无效")
  const amount = Math.floor(input.amount)
  if (!Number.isFinite(amount) || amount < 1 || amount > 100_000) {
    throw new Error("单次分配必须是 1 到 100000 之间的整数")
  }
  if (!input.ownerUserId || !input.childUserId || input.ownerUserId === input.childUserId) {
    throw new Error("积分分配账号无效")
  }
  return { ...input, operationId, amount }
}

export async function transferCreditsToManagedAccount(input: {
  operationId: string
  ownerUserId: string
  childUserId: string
  amount: number
}): Promise<TransferState> {
  const value = validate(input)
  const existing = await kv.get<TransferState>(key(value.operationId))
  if (existing) {
    if (
      existing.ownerUserId !== value.ownerUserId
      || existing.childUserId !== value.childUserId
      || existing.amount !== value.amount
    ) {
      throw new Error("积分分配操作号冲突")
    }
    if (existing.status === "completed") return existing
    if (existing.status === "failed") throw new Error(existing.error || "积分分配失败")
  }

  const now = new Date().toISOString()
  let state: TransferState = existing || {
    version: 1,
    operationId: value.operationId,
    ownerUserId: value.ownerUserId,
    childUserId: value.childUserId,
    amount: value.amount,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  }
  if (!existing) {
    const created = await kv.set(key(value.operationId), state, { nx: true, ex: TTL_SECONDS })
    if (!created) return transferCreditsToManagedAccount(value)
  }

  if (state.status === "pending") {
    try {
      const debit = await adjustCreditsByAdmin({
        operationId: `${value.operationId}_out`,
        userId: value.ownerUserId,
        delta: -value.amount,
        operatorUserId: value.ownerUserId,
        description: `向客户子账号分配 ${value.amount} 积分`,
      })
      state = {
        ...state,
        status: "debited",
        sourceBalance: debit.balance,
        updatedAt: new Date().toISOString(),
      }
      await kv.set(key(value.operationId), state, { ex: TTL_SECONDS })
    } catch (error) {
      state = {
        ...state,
        status: "failed",
        error: error instanceof Error ? error.message : "主账号积分扣除失败",
        updatedAt: new Date().toISOString(),
      }
      await kv.set(key(value.operationId), state, { ex: TTL_SECONDS })
      throw error
    }
  }

  try {
    const credit = await adjustCreditsByAdmin({
      operationId: `${value.operationId}_in`,
      userId: value.childUserId,
      delta: value.amount,
      operatorUserId: value.ownerUserId,
      description: `主账号分配 ${value.amount} 积分`,
    })
    state = {
      ...state,
      status: "completed",
      targetBalance: credit.balance,
      updatedAt: new Date().toISOString(),
    }
    await kv.set(key(value.operationId), state, { ex: TTL_SECONDS })
    return state
  } catch (error) {
    // 保留 debited 状态；用同一 operationId 重试会幂等续办，不会重复扣主账号。
    await kv.set(key(value.operationId), {
      ...state,
      status: "debited",
      error: error instanceof Error ? error.message : "客户账号积分到账待重试",
      updatedAt: new Date().toISOString(),
    }, { ex: TTL_SECONDS })
    throw new Error("主账号已完成预扣，客户账号到账待重试；请不要关闭窗口，直接再次提交")
  }
}

export async function managedAccountBalances(ownerUserId: string, childUserIds: string[]) {
  const entries = await Promise.all(childUserIds.map(async userId => {
    const snapshot = await getCreditBalanceSnapshot(userId)
    return [userId, snapshot] as const
  }))
  return new Map(entries)
}
