"use server"

import { cache } from "react"
import type { PenetrationByModel } from "@/types"
import {
  computeBrandVoice,
  computeKeywordCompetition,
  type BrandVoiceItem,
  type KeywordCompetitionItem,
} from "@/lib/dashboard-aggregations"

// React.cache 在单次请求内对相同入参做 memo，避免双面板各自触发时重复扫描。
// 注：因为 byModel 是大对象，缓存命中条件取决于引用相等（同一请求里两个 action
// 接收到的是同一份反序列化对象 → 我们用稳定的 cache key 间接传入）。
const _voiceCached = cache(
  (key: string, byModel: PenetrationByModel, ourBrand: string): BrandVoiceItem[] => {
    void key
    return computeBrandVoice(byModel, ourBrand)
  },
)

const _competitionCached = cache(
  (key: string, byModel: PenetrationByModel): KeywordCompetitionItem[] => {
    void key
    return computeKeywordCompetition(byModel)
  },
)

export interface DashboardPayload {
  byModel: PenetrationByModel
  ourBrand: string
  /** 用 penetration.generatedAt 等稳定字符串做 cache key，方便跨 action 命中同请求缓存 */
  cacheKey: string
}

export async function getBrandVoiceAction(
  payload: DashboardPayload,
): Promise<BrandVoiceItem[]> {
  return _voiceCached(payload.cacheKey, payload.byModel, payload.ourBrand)
}

export async function getKeywordCompetitionAction(
  payload: DashboardPayload,
): Promise<KeywordCompetitionItem[]> {
  return _competitionCached(payload.cacheKey, payload.byModel)
}
