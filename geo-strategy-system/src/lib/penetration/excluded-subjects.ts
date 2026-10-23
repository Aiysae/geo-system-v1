import "server-only"

import { kv } from "@/lib/kv"
import type { Client } from "@/types"

// Names that come up in AI answers but are not competitors, such as a
// government platform the answers point to for checking a licence. An admin
// keeps a list for every client; each client can add its own.

const GLOBAL_KEY = "geo:penetration:excluded-subjects"
const NAME_LIMIT = 120
const LIST_LIMIT = 500

export function normalizeExcludedSubjects(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const value of values) {
    const name = String(value ?? "").trim().slice(0, NAME_LIMIT)
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
    if (names.length >= LIST_LIMIT) break
  }
  return names
}

export async function getGlobalExcludedSubjects(): Promise<string[]> {
  return normalizeExcludedSubjects(await kv.get<string[]>(GLOBAL_KEY).catch(() => []))
}

export async function setGlobalExcludedSubjects(values: unknown): Promise<string[]> {
  const names = normalizeExcludedSubjects(values)
  await kv.set(GLOBAL_KEY, names)
  return names
}

/** What a client's rankings leave out: the admin's list and its own. */
export async function excludedSubjectsFor(client: Pick<Client, "excludedSubjects"> | null | undefined): Promise<string[]> {
  return normalizeExcludedSubjects([...(await getGlobalExcludedSubjects()), ...(client?.excludedSubjects || [])])
}
