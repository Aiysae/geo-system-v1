import "server-only"

import { randomUUID } from "crypto"
import { kv } from "@/lib/kv"
import type { VideoProductionItem } from "@/types/video-production"

export interface StoredVideoProductionItem extends VideoProductionItem {
  dataOwnerUserId: string
  createdByUserId: string
  requestId: string
}

const ITEM_TTL_SECONDS = 60 * 60 * 24 * 365
const MAX_LISTED_ITEMS = 300

const itemKey = (id: string) => `geo:video-production:item:${id}`
const indexKey = (dataOwnerUserId: string, clientId: string) => (
  `geo:video-production:index:${dataOwnerUserId}:${clientId}`
)

export function newVideoProductionId(prefix: "vpi" | "vpb" | "vps"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`
}

export function toPublicVideoProductionItem(item: StoredVideoProductionItem): VideoProductionItem {
  const { dataOwnerUserId, createdByUserId, requestId, ...rest } = item
  return rest
}

export async function getVideoProductionItem(id: string): Promise<StoredVideoProductionItem | null> {
  if (!/^vpi_[a-f0-9]{32}$/.test(id)) return null
  return kv.get<StoredVideoProductionItem>(itemKey(id))
}

export async function saveVideoProductionItem(item: StoredVideoProductionItem): Promise<void> {
  await kv.set(itemKey(item.id), item, { ex: ITEM_TTL_SECONDS })
  await kv.sadd(indexKey(item.dataOwnerUserId, item.clientId), item.id)
}

export async function patchVideoProductionItem(
  id: string,
  patch: Partial<StoredVideoProductionItem> | ((current: StoredVideoProductionItem) => Partial<StoredVideoProductionItem>),
): Promise<StoredVideoProductionItem | null> {
  const current = await getVideoProductionItem(id)
  if (!current) return null
  const changes = typeof patch === "function" ? patch(current) : patch
  const next = { ...current, ...changes, updatedAt: new Date().toISOString() }
  await kv.set(itemKey(id), next, { ex: ITEM_TTL_SECONDS })
  return next
}

export async function deleteVideoProductionItem(item: StoredVideoProductionItem): Promise<void> {
  await kv.del(itemKey(item.id))
  await kv.srem(indexKey(item.dataOwnerUserId, item.clientId), item.id)
}

export async function listVideoProductionItems(
  dataOwnerUserId: string,
  clientId: string,
): Promise<StoredVideoProductionItem[]> {
  const ids = await kv.smembers<string[]>(indexKey(dataOwnerUserId, clientId))
  const items = await Promise.all((ids || []).map(id => getVideoProductionItem(id)))
  const missing = (ids || []).filter((_, index) => !items[index])
  if (missing.length > 0) await kv.srem(indexKey(dataOwnerUserId, clientId), ...missing)
  return items
    .filter((item): item is StoredVideoProductionItem => Boolean(item))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_LISTED_ITEMS)
}
