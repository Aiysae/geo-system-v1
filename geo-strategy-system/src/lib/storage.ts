"use client"

import type { Client, ModelKey } from "@/types"

const STORAGE_KEY = "geo:clients"
const ACTIVE_KEY = "geo:activeClientId"

function hasLs(): boolean {
  return typeof window !== "undefined" && !!window.localStorage
}

export function listClients(): Client[] {
  if (!hasLs()) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function saveClients(clients: Client[]): void {
  if (!hasLs()) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clients))
}

export function getActiveId(): string | null {
  if (!hasLs()) return null
  return window.localStorage.getItem(ACTIVE_KEY)
}

export function setActiveId(id: string | null): void {
  if (!hasLs()) return
  if (id == null) window.localStorage.removeItem(ACTIVE_KEY)
  else window.localStorage.setItem(ACTIVE_KEY, id)
}

export function upsertClient(client: Client): Client {
  const list = listClients()
  const idx = list.findIndex(c => c.id === client.id)
  const next: Client = { ...client, updatedAt: new Date().toISOString() }
  if (idx >= 0) list[idx] = next
  else list.unshift(next)
  saveClients(list)
  return next
}

export function deleteClient(id: string): void {
  const list = listClients().filter(c => c.id !== id)
  saveClients(list)
  if (getActiveId() === id) setActiveId(list[0]?.id ?? null)
}

const DEFAULT_MODELS: ModelKey[] = ["doubao", "deepseek"]

export function createClient(name: string): Client {
  const now = new Date().toISOString()
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    name,
    ourBrand: "",
    industry: "",
    website: "",
    questions: [],
    competitors: [],
    selectedModels: DEFAULT_MODELS,
    createdAt: now,
    updatedAt: now,
  }
}
