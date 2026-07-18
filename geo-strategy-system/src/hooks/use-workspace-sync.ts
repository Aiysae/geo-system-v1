"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Client } from "@/types"
import {
  createClient,
  canClaimLegacyWorkspace,
  getActiveId,
  isLegacyMigrationComplete,
  listCachedClients,
  listLegacyClients,
  markLegacyMigrationComplete,
  saveCachedClients,
  setActiveId as persistActiveId,
  workspaceImportId,
} from "@/lib/storage"
import {
  emptyWorkspaceVersions,
  type SyncedClient,
  type WorkspaceVersions,
} from "@/lib/workspace-sync"

export type WorkspaceSyncPhase = "loading" | "idle" | "saving" | "saved" | "error" | "conflict"

export type WorkspaceSyncState = {
  phase: WorkspaceSyncPhase
  message: string
  savedAt?: string
}

type WorkspaceConflict = {
  clientId: string
  current: SyncedClient
  localPatch: Partial<Client>
}

type WorkspaceImportSummary = {
  importedCount: number
  duplicatedCount: number
  alreadyImported: boolean
  clients: SyncedClient[]
}

const SAVE_DELAY_MS = 800
const REFRESH_INTERVAL_MS = 30_000
const CLIENT_ACCOUNT_PATCH_FIELDS = new Set<keyof Client>([
  "questions",
  "selectedModels",
  "penetration",
  "penetrationJobId",
])

export function useWorkspaceSync(
  userId: string,
  options: { restrictedClientId?: string } = {},
) {
  const restrictedClientId = options.restrictedClientId
  const filterRestrictedClients = useCallback(
    (values: Client[]) => restrictedClientId
      ? values.filter(client => client.id === restrictedClientId)
      : values,
    [restrictedClientId],
  )
  const [clients, setClients] = useState<Client[]>(() => {
    const cached = listCachedClients(userId)
    return restrictedClientId
      ? cached.filter(client => client.id === restrictedClientId)
      : cached
  })
  const [activeId, setActiveIdState] = useState<string | null>(() => {
    const allCached = listCachedClients(userId)
    const cached = restrictedClientId
      ? allCached.filter(client => client.id === restrictedClientId)
      : allCached
    const preferred = getActiveId(userId)
    return preferred && cached.some(client => client.id === preferred) ? preferred : cached[0]?.id || null
  })
  const [hydrated, setHydrated] = useState(false)
  const [syncState, setSyncState] = useState<WorkspaceSyncState>({
    phase: "loading",
    message: "正在读取云端数据",
  })
  const [legacyClients, setLegacyClients] = useState<Client[]>([])
  const [showMigration, setShowMigration] = useState(false)
  const [conflict, setConflict] = useState<WorkspaceConflict | null>(null)

  const clientsRef = useRef<Client[]>([])
  const versionsRef = useRef<Record<string, WorkspaceVersions>>({})
  const pendingPatchesRef = useRef<Record<string, Partial<Client>>>({})
  const pendingCreatesRef = useRef<Record<string, Client>>({})
  const creatingClientsRef = useRef(new Set<string>())
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const savingClientsRef = useRef(new Set<string>())
  const flushClientRef = useRef<(clientId: string, force?: boolean) => void>(() => undefined)
  const conflictRef = useRef<WorkspaceConflict | null>(null)

  const applySyncedClients = useCallback((records: SyncedClient[]) => {
    const scopedRecords = restrictedClientId
      ? records.filter(record => record.client.id === restrictedClientId)
      : records
    const nextClients = filterRestrictedClients(scopedRecords.map(record => record.client))
    versionsRef.current = Object.fromEntries(scopedRecords.map(record => [record.client.id, record.versions]))
    clientsRef.current = nextClients
    setClients(nextClients)
    saveCachedClients(userId, nextClients)
    setActiveIdState(previous => {
      const preferred = previous || getActiveId(userId)
      const resolved = preferred && nextClients.some(client => client.id === preferred)
        ? preferred
        : nextClients[0]?.id || null
      persistActiveId(userId, resolved)
      return resolved
    })
  }, [filterRestrictedClients, restrictedClientId, userId])

  const fetchCloudClients = useCallback(async (silent = false): Promise<SyncedClient[]> => {
    const response = await fetch("/api/workspace/clients", {
      cache: "no-store",
      credentials: "same-origin",
    })
    if (response.status === 401) {
      window.location.replace("/sign-in?redirect_url=/workspace")
      throw new Error("登录状态已失效")
    }
    const body = await response.json().catch(() => ({})) as { clients?: SyncedClient[]; error?: string }
    if (!response.ok || !Array.isArray(body.clients)) {
      throw new Error(body.error || `云端数据读取失败（HTTP ${response.status}）`)
    }
    if (!silent) applySyncedClients(body.clients)
    return body.clients
  }, [applySyncedClients])

  useEffect(() => {
    let cancelled = false
    async function hydrate() {
      try {
        const records = await fetchCloudClients(true)
        if (cancelled) return
        applySyncedClients(records)
        setSyncState({ phase: "idle", message: "云端数据已同步" })
      } catch (error) {
        if (cancelled) return
        setSyncState({
          phase: "error",
          message: error instanceof Error ? error.message : "云端数据读取失败",
        })
      } finally {
        if (!cancelled) setHydrated(true)
      }

      if (
        !cancelled
        && !restrictedClientId
        && !isLegacyMigrationComplete(userId)
        && canClaimLegacyWorkspace(userId)
      ) {
        const legacy = listLegacyClients()
        if (legacy.length > 0) {
          setLegacyClients(legacy)
          setShowMigration(true)
        }
      }
    }
    void hydrate()
    return () => {
      cancelled = true
    }
  }, [applySyncedClients, fetchCloudClients, restrictedClientId, userId])

  useEffect(() => {
    clientsRef.current = clients
    if (!hydrated) return
    const timer = setTimeout(() => saveCachedClients(userId, clients), SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [clients, hydrated, userId])

  const persistCreate = useCallback(async (client: Client) => {
    if (creatingClientsRef.current.has(client.id)) return
    creatingClientsRef.current.add(client.id)
    pendingCreatesRef.current[client.id] = client
    setSyncState({ phase: "saving", message: "正在创建云端客户" })
    try {
      const response = await fetch("/api/workspace/clients", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client }),
      })
      const body = await response.json().catch(() => ({})) as SyncedClient & { error?: string }
      if (!response.ok || !body.client || !body.versions) {
        throw new Error(body.error || `客户创建失败（HTTP ${response.status}）`)
      }
      delete pendingCreatesRef.current[client.id]
      versionsRef.current[client.id] = body.versions
      setClients(previous => previous.map(item => item.id === client.id
        ? { ...body.client, ...(pendingPatchesRef.current[client.id] || {}) }
        : item))
      setSyncState({ phase: "saved", message: "已保存到云端", savedAt: new Date().toISOString() })
      if (pendingPatchesRef.current[client.id]) {
        setTimeout(() => flushClientRef.current(client.id), 0)
      }
    } catch (error) {
      setSyncState({
        phase: "error",
        message: error instanceof Error ? error.message : "客户创建失败",
      })
    } finally {
      creatingClientsRef.current.delete(client.id)
    }
  }, [])

  const flushClient = useCallback(async (clientId: string, force = false) => {
    if (savingClientsRef.current.has(clientId)) return
    if (!force && conflictRef.current?.clientId === clientId) return
    if (pendingCreatesRef.current[clientId]) return
    const patch = pendingPatchesRef.current[clientId]
    if (!patch || Object.keys(patch).length === 0) return
    delete pendingPatchesRef.current[clientId]
    savingClientsRef.current.add(clientId)
    setSyncState({ phase: "saving", message: "正在保存到云端" })
    const unsetFields = Object.keys(patch).filter(key => patch[key as keyof Client] === undefined)
    const serializablePatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    )

    let didConflict = false
    try {
      const response = await fetch(`/api/workspace/clients/${encodeURIComponent(clientId)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: serializablePatch,
          unsetFields,
          expectedVersions: versionsRef.current[clientId] || emptyWorkspaceVersions(),
          force,
        }),
      })
      const body = await response.json().catch(() => ({})) as SyncedClient & {
        error?: string
        code?: string
        current?: SyncedClient
      }
      if (response.status === 409 && body.code === "WORKSPACE_CONFLICT" && body.current) {
        didConflict = true
        const nextConflict = { clientId, current: body.current, localPatch: patch }
        conflictRef.current = nextConflict
        setConflict(nextConflict)
        setSyncState({ phase: "conflict", message: "另一台设备已更新当前数据" })
        return
      }
      if (!response.ok || !body.client || !body.versions) {
        throw new Error(body.error || `云端保存失败（HTTP ${response.status}）`)
      }
      versionsRef.current[clientId] = body.versions
      setClients(previous => previous.map(item => item.id === clientId
        ? { ...body.client, ...(pendingPatchesRef.current[clientId] || {}) }
        : item))
      setSyncState({ phase: "saved", message: "已保存到云端", savedAt: new Date().toISOString() })
    } catch (error) {
      pendingPatchesRef.current[clientId] = {
        ...patch,
        ...(pendingPatchesRef.current[clientId] || {}),
      }
      setSyncState({
        phase: "error",
        message: error instanceof Error ? error.message : "云端保存失败",
      })
    } finally {
      savingClientsRef.current.delete(clientId)
      if (pendingPatchesRef.current[clientId] && !didConflict) {
        saveTimersRef.current[clientId] = setTimeout(() => flushClientRef.current(clientId), 150)
      }
    }
  }, [])

  useEffect(() => {
    flushClientRef.current = (clientId, force) => {
      void flushClient(clientId, force)
    }
  }, [flushClient])

  const scheduleSave = useCallback((clientId: string) => {
    if (saveTimersRef.current[clientId]) clearTimeout(saveTimersRef.current[clientId])
    saveTimersRef.current[clientId] = setTimeout(() => void flushClient(clientId), SAVE_DELAY_MS)
  }, [flushClient])

  const handleSelect = useCallback((id: string) => {
    setActiveIdState(id)
    persistActiveId(userId, id)
  }, [userId])

  const handleCreate = useCallback((name: string) => {
    if (restrictedClientId) return
    const client = createClient(name)
    setClients(previous => [client, ...previous])
    setActiveIdState(client.id)
    persistActiveId(userId, client.id)
    void persistCreate(client)
  }, [persistCreate, restrictedClientId, userId])

  const handleDelete = useCallback((id: string) => {
    if (restrictedClientId) return
    const snapshot = clientsRef.current
    const next = snapshot.filter(client => client.id !== id)
    setClients(next)
    if (activeId === id) {
      const replacement = next[0]?.id || null
      setActiveIdState(replacement)
      persistActiveId(userId, replacement)
    }
    void (async () => {
      try {
        const response = await fetch(`/api/workspace/clients/${encodeURIComponent(id)}`, {
          method: "DELETE",
          credentials: "same-origin",
        })
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string }
          throw new Error(body.error || `删除失败（HTTP ${response.status}）`)
        }
        delete versionsRef.current[id]
        delete pendingPatchesRef.current[id]
        setSyncState({ phase: "saved", message: "云端客户已删除", savedAt: new Date().toISOString() })
      } catch (error) {
        setClients(snapshot)
        setSyncState({ phase: "error", message: error instanceof Error ? error.message : "删除失败" })
      }
    })()
  }, [activeId, restrictedClientId, userId])

  const handleChangeClient = useCallback((patch: Partial<Client>) => {
    if (!activeId) return
    const clientId = activeId
    const scopedPatch = restrictedClientId
      ? Object.fromEntries(
          Object.entries(patch).filter(([field]) =>
            CLIENT_ACCOUNT_PATCH_FIELDS.has(field as keyof Client)
          ),
        ) as Partial<Client>
      : patch
    if (Object.keys(scopedPatch).length === 0) return
    const localPatch = { ...scopedPatch, updatedAt: new Date().toISOString() }
    setClients(previous => previous.map(client => client.id === clientId ? { ...client, ...localPatch } : client))
    pendingPatchesRef.current[clientId] = {
      ...(pendingPatchesRef.current[clientId] || {}),
      ...scopedPatch,
    }
    scheduleSave(clientId)
  }, [activeId, restrictedClientId, scheduleSave])

  const refresh = useCallback(async () => {
    if (
      Object.keys(pendingPatchesRef.current).length > 0
      || Object.keys(pendingCreatesRef.current).length > 0
      || savingClientsRef.current.size > 0
      || conflict
    ) return
    try {
      const records = await fetchCloudClients(true)
      applySyncedClients(records)
      setSyncState(current => current.phase === "error"
        ? { phase: "idle", message: "云端数据已恢复" }
        : current)
    } catch (error) {
      setSyncState({ phase: "error", message: error instanceof Error ? error.message : "同步失败" })
    }
  }, [applySyncedClients, conflict, fetchCloudClients])

  const retry = useCallback(() => {
    for (const client of Object.values(pendingCreatesRef.current)) void persistCreate(client)
    for (const clientId of Object.keys(pendingPatchesRef.current)) scheduleSave(clientId)
    if (
      Object.keys(pendingCreatesRef.current).length === 0
      && Object.keys(pendingPatchesRef.current).length === 0
    ) void refresh()
  }, [persistCreate, refresh, scheduleSave])

  useEffect(() => {
    const timers = saveTimersRef.current
    const onFocus = () => void refresh()
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        for (const clientId of Object.keys(pendingPatchesRef.current)) void flushClient(clientId)
      } else {
        void refresh()
      }
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibility)
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibility)
      window.clearInterval(interval)
      for (const timer of Object.values(timers)) clearTimeout(timer)
    }
  }, [flushClient, refresh])

  const importLegacy = useCallback(async () => {
    if (legacyClients.length === 0) return
    setSyncState({ phase: "saving", message: "正在导入本机历史数据" })
    try {
      const response = await fetch("/api/workspace/import", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId: workspaceImportId(legacyClients), clients: legacyClients }),
      })
      const body = await response.json().catch(() => ({})) as WorkspaceImportSummary & { error?: string }
      if (!response.ok || !Array.isArray(body.clients)) {
        throw new Error(body.error || `历史数据导入失败（HTTP ${response.status}）`)
      }
      markLegacyMigrationComplete(userId)
      setShowMigration(false)
      applySyncedClients(body.clients)
      const duplicateText = body.duplicatedCount > 0 ? `，${body.duplicatedCount} 个冲突客户已保留副本` : ""
      setSyncState({
        phase: "saved",
        message: `已同步 ${body.importedCount} 个本机客户${duplicateText}`,
        savedAt: new Date().toISOString(),
      })
    } catch (error) {
      setSyncState({ phase: "error", message: error instanceof Error ? error.message : "历史数据导入失败" })
    }
  }, [applySyncedClients, legacyClients, userId])

  const loadCloudConflictVersion = useCallback(() => {
    if (!conflict) return
    versionsRef.current[conflict.clientId] = conflict.current.versions
    delete pendingPatchesRef.current[conflict.clientId]
    setClients(previous => previous.map(client => client.id === conflict.clientId ? conflict.current.client : client))
    conflictRef.current = null
    setConflict(null)
    setSyncState({ phase: "idle", message: "已加载云端最新版本" })
  }, [conflict])

  const overwriteCloudConflictVersion = useCallback(() => {
    if (!conflict) return
    versionsRef.current[conflict.clientId] = conflict.current.versions
    pendingPatchesRef.current[conflict.clientId] = {
      ...conflict.localPatch,
      ...(pendingPatchesRef.current[conflict.clientId] || {}),
    }
    const clientId = conflict.clientId
    conflictRef.current = null
    setConflict(null)
    void flushClient(clientId, true)
  }, [conflict, flushClient])

  return {
    clients,
    activeId,
    hydrated,
    syncState,
    conflict,
    showMigration,
    legacyClientCount: legacyClients.length,
    handleSelect,
    handleCreate,
    handleDelete,
    handleChangeClient,
    retry,
    importLegacy,
    dismissMigration: () => setShowMigration(false),
    loadCloudConflictVersion,
    overwriteCloudConflictVersion,
  }
}
