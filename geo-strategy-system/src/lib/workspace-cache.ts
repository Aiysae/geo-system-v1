"use client"

import {
  emptyWorkspaceVersions,
  type WorkspaceSection,
  type WorkspaceSectionSnapshot,
  type WorkspaceVersions,
} from "@/lib/workspace-sync"

type CachedSectionRecord = {
  key: string
  scope: string
  clientId: string
  section: WorkspaceSection
  version: number
  data: Record<string, unknown>
  cachedAt: number
}

const DATABASE_NAME = "geo-workspace-cache"
const STORE_NAME = "sections"
const DATABASE_VERSION = 1

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
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("本机缓存打开失败"))
  })
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
    const transaction = database.transaction(STORE_NAME, "readwrite")
    const store = transaction.objectStore(STORE_NAME)
    for (const section of Object.keys(emptyWorkspaceVersions()) as WorkspaceSection[]) {
      store.delete(cacheKey(scope, clientId, section))
    }
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
