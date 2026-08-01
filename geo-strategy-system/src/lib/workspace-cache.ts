"use client"

import {
  emptyWorkspaceVersions,
  type WorkspaceSection,
  type WorkspaceSectionSnapshot,
  type WorkspaceVersions,
} from "@/lib/workspace-sync"
import type { Client } from "@/types"
import {
  mergeWorkspaceDraftPatches,
  removeAcknowledgedWorkspaceDraftFields,
} from "@/lib/workspace-draft"

type CachedSectionRecord = {
  key: string
  scope: string
  clientId: string
  section: WorkspaceSection
  version: number
  data: Record<string, unknown>
  cachedAt: number
}

type CachedDraftRecord = {
  key: string
  scope: string
  clientId: string
  patch: Partial<Client>
  updatedAt: number
}

const DATABASE_NAME = "geo-workspace-cache"
const STORE_NAME = "sections"
const DRAFT_STORE_NAME = "drafts"
const DATABASE_VERSION = 2

function cacheKey(scope: string, clientId: string, section: WorkspaceSection): string {
  return [scope, clientId, section].map(encodeURIComponent).join(":")
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" })
      }
      if (!database.objectStoreNames.contains(DRAFT_STORE_NAME)) {
        database.createObjectStore(DRAFT_STORE_NAME, { keyPath: "key" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("本机缓存打开失败"))
  })
}

function draftKey(scope: string, clientId: string): string {
  return [scope, clientId, "draft"].map(encodeURIComponent).join(":")
}

export async function readCachedWorkspaceDraft(
  scope: string,
  clientId: string,
): Promise<Partial<Client>> {
  try {
    const database = await openDatabase()
    if (!database) return {}
    const transaction = database.transaction(DRAFT_STORE_NAME, "readonly")
    const record = await requestValue(
      transaction.objectStore(DRAFT_STORE_NAME).get(draftKey(scope, clientId)) as IDBRequest<CachedDraftRecord | undefined>,
    )
    database.close()
    return record?.patch || {}
  } catch (error) {
    console.warn("[workspace-cache] draft read skipped", error)
    return {}
  }
}

export async function writeCachedWorkspaceDraftPatch(
  scope: string,
  clientId: string,
  patch: Partial<Client>,
): Promise<void> {
  try {
    const database = await openDatabase()
    if (!database) return
    const transaction = database.transaction(DRAFT_STORE_NAME, "readwrite")
    const store = transaction.objectStore(DRAFT_STORE_NAME)
    const key = draftKey(scope, clientId)
    const current = await requestValue(store.get(key) as IDBRequest<CachedDraftRecord | undefined>)
    store.put({
      key,
      scope,
      clientId,
      patch: mergeWorkspaceDraftPatches(current?.patch, patch),
      updatedAt: Date.now(),
    } satisfies CachedDraftRecord)
    await transactionDone(transaction)
    database.close()
  } catch (error) {
    console.warn("[workspace-cache] draft write skipped", error)
  }
}

export async function acknowledgeCachedWorkspaceDraftPatch(
  scope: string,
  clientId: string,
  acknowledged: Partial<Client>,
): Promise<void> {
  try {
    const database = await openDatabase()
    if (!database) return
    const transaction = database.transaction(DRAFT_STORE_NAME, "readwrite")
    const store = transaction.objectStore(DRAFT_STORE_NAME)
    const key = draftKey(scope, clientId)
    const current = await requestValue(store.get(key) as IDBRequest<CachedDraftRecord | undefined>)
    if (current) {
      const patch = removeAcknowledgedWorkspaceDraftFields(current.patch, acknowledged)
      if (Object.keys(patch).length === 0) store.delete(key)
      else store.put({ ...current, patch, updatedAt: Date.now() } satisfies CachedDraftRecord)
    }
    await transactionDone(transaction)
    database.close()
  } catch (error) {
    console.warn("[workspace-cache] draft acknowledgement skipped", error)
  }
}

export async function clearCachedWorkspaceDraft(
  scope: string,
  clientId: string,
): Promise<void> {
  try {
    const database = await openDatabase()
    if (!database) return
    const transaction = database.transaction(DRAFT_STORE_NAME, "readwrite")
    transaction.objectStore(DRAFT_STORE_NAME).delete(draftKey(scope, clientId))
    await transactionDone(transaction)
    database.close()
  } catch (error) {
    console.warn("[workspace-cache] draft clear skipped", error)
  }
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("本机缓存读取失败"))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error("本机缓存写入失败"))
    transaction.onabort = () => reject(transaction.error || new Error("本机缓存写入已取消"))
  })
}

export async function readCachedWorkspaceSections(
  scope: string,
  clientId: string,
  requestedSections: readonly WorkspaceSection[],
): Promise<WorkspaceSectionSnapshot | null> {
  try {
    const database = await openDatabase()
    if (!database) return null
    const sections = Array.from(new Set<WorkspaceSection>(["core", ...requestedSections]))
    const transaction = database.transaction(STORE_NAME, "readonly")
    const store = transaction.objectStore(STORE_NAME)
    const records = await Promise.all(sections.map(section => (
      requestValue(store.get(cacheKey(scope, clientId, section)) as IDBRequest<CachedSectionRecord | undefined>)
    )))
    database.close()
    if (!records[0]) return null
    const versions = emptyWorkspaceVersions()
    const data: WorkspaceSectionSnapshot["sections"] = {}
    const loadedSections: WorkspaceSection[] = []
    for (const record of records) {
      if (!record) continue
      versions[record.section] = record.version
      data[record.section] = record.data
      loadedSections.push(record.section)
    }
    return {
      clientId,
      sections: data,
      versions,
      loadedSections,
    }
  } catch (error) {
    console.warn("[workspace-cache] read skipped", error)
    return null
  }
}

export async function writeCachedWorkspaceSections(
  scope: string,
  snapshot: WorkspaceSectionSnapshot,
): Promise<void> {
  try {
    const database = await openDatabase()
    if (!database) return
    const transaction = database.transaction(STORE_NAME, "readwrite")
    const store = transaction.objectStore(STORE_NAME)
    for (const section of snapshot.loadedSections) {
      const data = snapshot.sections[section]
      if (!data) continue
      const record: CachedSectionRecord = {
        key: cacheKey(scope, snapshot.clientId, section),
        scope,
        clientId: snapshot.clientId,
        section,
        version: snapshot.versions[section] || 0,
        data,
        cachedAt: Date.now(),
      }
      store.put(record)
    }
    await transactionDone(transaction)
    database.close()
  } catch (error) {
    console.warn("[workspace-cache] write skipped", error)
  }
}

export async function deleteCachedWorkspaceClient(
  scope: string,
  clientId: string,
): Promise<void> {
  try {
    const database = await openDatabase()
    if (!database) return
    const transaction = database.transaction([STORE_NAME, DRAFT_STORE_NAME], "readwrite")
    const store = transaction.objectStore(STORE_NAME)
    for (const section of Object.keys(emptyWorkspaceVersions()) as WorkspaceSection[]) {
      store.delete(cacheKey(scope, clientId, section))
    }
    transaction.objectStore(DRAFT_STORE_NAME).delete(draftKey(scope, clientId))
    await transactionDone(transaction)
    database.close()
  } catch (error) {
    console.warn("[workspace-cache] delete skipped", error)
  }
}

export function mergeWorkspaceVersions(
  current: WorkspaceVersions,
  incoming: WorkspaceVersions,
  loadedSections: readonly WorkspaceSection[],
): WorkspaceVersions {
  const next = { ...current }
  for (const section of loadedSections) next[section] = incoming[section] || 0
  return next
}
