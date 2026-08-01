import type { Client } from "@/types"

function equalDraftValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

export function mergeWorkspaceDraftPatches(
  stored: Partial<Client> | undefined,
  incoming: Partial<Client>,
): Partial<Client> {
  return { ...(stored || {}), ...incoming }
}

export function removeAcknowledgedWorkspaceDraftFields(
  current: Partial<Client>,
  acknowledged: Partial<Client>,
): Partial<Client> {
  const next = { ...current }
  for (const [field, value] of Object.entries(acknowledged)) {
    const key = field as keyof Client
    if (equalDraftValue(next[key], value)) delete next[key]
  }
  return next
}
