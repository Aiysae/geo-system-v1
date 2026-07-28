"use client"

import type { AnalysisSubjectType, Client, ModelKey } from "@/types"
import { createEmptyPersonSubjectProfile } from "@/lib/analysis-subject"
import { emptyClientKnowledgeBase } from "@/lib/client-knowledge-base"
import { normalizePenetrationQuestionGenerationSettings } from "@/lib/penetration/sample-design"

const LEGACY_CLIENTS_KEY = "geo:clients"
const LEGACY_ACTIVE_KEY = "geo:activeClientId"
const LEGACY_OWNER_KEY = "geo:legacyWorkspaceOwner"
const DEVICE_KEY = "geo:syncDeviceId"

const cacheKey = (userId: string) => `geo:clients:${userId}`
const activeKey = (userId: string) => `geo:activeClientId:${userId}`
const migrationKey = (userId: string) => `geo:workspaceMigration:${userId}`

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage)
}

function readClientArray(key: string): Client[] {
  if (!hasLocalStorage()) return []
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function listLegacyClients(): Client[] {
  return readClientArray(LEGACY_CLIENTS_KEY)
}

export function listCachedClients(userId: string): Client[] {
  return readClientArray(cacheKey(userId))
}

export function saveCachedClients(userId: string, clients: Client[]): void {
  if (!hasLocalStorage()) return
  try {
    window.localStorage.setItem(cacheKey(userId), JSON.stringify(clients))
  } catch (error) {
    console.warn("[workspace-cache] local cache write skipped", error)
  }
}

export function getActiveId(userId: string): string | null {
  if (!hasLocalStorage()) return null
  return window.localStorage.getItem(activeKey(userId))
    || window.localStorage.getItem(LEGACY_ACTIVE_KEY)
}

export function setActiveId(userId: string, id: string | null): void {
  if (!hasLocalStorage()) return
  if (id == null) window.localStorage.removeItem(activeKey(userId))
  else window.localStorage.setItem(activeKey(userId), id)
}

export function isLegacyMigrationComplete(userId: string): boolean {
  if (!hasLocalStorage()) return false
  return window.localStorage.getItem(migrationKey(userId)) === "complete"
}

export function canClaimLegacyWorkspace(userId: string): boolean {
  if (!hasLocalStorage()) return false
  const owner = window.localStorage.getItem(LEGACY_OWNER_KEY)
  return !owner || owner === userId
}

export function markLegacyMigrationComplete(userId: string): void {
  if (!hasLocalStorage()) return
  window.localStorage.setItem(migrationKey(userId), "complete")
  window.localStorage.setItem(LEGACY_OWNER_KEY, userId)
}

export function workspaceImportId(clients: Client[]): string {
  const payload = JSON.stringify(clients)
  let hash = 2166136261
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${getDeviceId()}:${clients.length}:${(hash >>> 0).toString(16)}`
}

function getDeviceId(): string {
  if (!hasLocalStorage()) return "server"
  const current = window.localStorage.getItem(DEVICE_KEY)
  if (current) return current
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `device_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  window.localStorage.setItem(DEVICE_KEY, id)
  return id
}

const DEFAULT_MODELS: ModelKey[] = ["doubao", "deepseek", "qwen", "kimi", "ernie", "hunyuan"]

export function createClient(
  name: string,
  subjectType: AnalysisSubjectType = "brand",
): Client {
  const now = new Date().toISOString()
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    name,
    subjectType,
    personProfile: subjectType === "person"
      ? createEmptyPersonSubjectProfile()
      : undefined,
    ourBrand: "",
    brandAliases: [],
    industry: "",
    website: "",
    questions: [],
    questionGenerationSettings: normalizePenetrationQuestionGenerationSettings(undefined),
    questionIntentHints: [],
    competitors: [],
    knowledgeBase: emptyClientKnowledgeBase({
      subjectType,
      subjectName: name,
    }),
    selectedModels: DEFAULT_MODELS,
    createdAt: now,
    updatedAt: now,
  }
}
