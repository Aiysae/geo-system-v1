"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { AnalysisSubjectType, Client } from "@/types"
import {
  createClient,
  canClaimLegacyWorkspace,
  getActiveId,
  isLegacyMigrationComplete,
  listLegacyClients,
  markLegacyMigrationComplete,
  setActiveId as persistActiveId,
  workspaceImportId,
} from "@/lib/storage"
import {
  acknowledgeCachedWorkspaceDraftPatch,
  deleteCachedWorkspaceClient,
  mergeWorkspaceVersions,
  readCachedWorkspaceDraft,
  readCachedWorkspaceSections,
  writeCachedWorkspaceDraftPatch,
  writeCachedWorkspaceSections,
} from "@/lib/workspace-cache"
import {
  WORKSPACE_SECTIONS,
  composeClientData,
  emptyWorkspaceVersions,
  isLocalWorkspaceField,
  normalizeWorkspaceSections,
  sectionsForClientPatch,
  splitClientData,
  type SyncedClient,
  type WorkspaceSection,
  type WorkspaceSectionSnapshot,
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

type WorkspaceManifest = {
  id: string
  name: string
  versions: WorkspaceVersions
  updatedAt: string
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

function requestedClientId(): string {
  if (typeof window === "undefined") return ""
  return String(new URL(window.location.href).searchParams.get("clientId") || "").trim()
}

function sameVersions(
  left: WorkspaceVersions | undefined,
  right: WorkspaceVersions | undefined,
  sections: readonly WorkspaceSection[],
): boolean {
  if (!left || !right) return false
  return sections.every(section => left[section] === right[section])
}

function shouldSaveWorkspacePatchImmediately(patch: Partial<Client>): boolean {
  if (
    Object.prototype.hasOwnProperty.call(patch, "backgroundJobs")
    || Object.prototype.hasOwnProperty.call(patch, "penetrationJobId")
    || Object.prototype.hasOwnProperty.call(patch, "difficultyJobId")
  ) return true
  const keyword = patch.keywordStrategy
  if (keyword && (
    keyword.extracting
    || keyword.advantageStatus === "generating"
    || keyword.strategyStatus === "generating"
    || keyword.questionStatus === "generating"
  )) return true
  return patch.articleGeneration?.status === "generating"
}

export function useWorkspaceSync(
  userId: string,
  options: {
    restrictedClientId?: string
    teamId?: string
    initialClientId?: string
    sections?: readonly WorkspaceSection[]
  } = {},
) {
  const restrictedClientId = options.restrictedClientId
  const initialClientId = String(options.initialClientId || "").trim()
  const teamId = String(options.teamId || "").trim()
  const storageUserId = teamId ? `${userId}:team:${teamId}` : userId
  const requestedSectionKey = (options.sections || ["core", "jobs"]).join(",")
  const desiredSections = useMemo(
    () => normalizeWorkspaceSections(requestedSectionKey.split(",")),
    [requestedSectionKey],
  )
  const desiredSectionsRef = useRef(desiredSections)
  const [clients, setClients] = useState<Client[]>([])
  const [clientDirectory, setClientDirectory] = useState<Array<Pick<Client, "id" | "name">>>([])
  const [activeId, setActiveIdState] = useState<string | null>(() => (
    restrictedClientId || initialClientId || requestedClientId() || getActiveId(storageUserId)
  ))
  const [hydrated, setHydrated] = useState(false)
  const [syncState, setSyncState] = useState<WorkspaceSyncState>({
    phase: "loading",
    message: "正在读取客户资料",
  })
  const [legacyClients, setLegacyClients] = useState<Client[]>([])
  const [showMigration, setShowMigration] = useState(false)
  const [conflict, setConflict] = useState<WorkspaceConflict | null>(null)
  const [loadedSectionsByClient, setLoadedSectionsByClient] = useState<Record<string, WorkspaceSection[]>>({})

  const clientsRef = useRef<Client[]>([])
  const activeIdRef = useRef<string | null>(activeId)
  const manifestsRef = useRef<Record<string, WorkspaceManifest>>({})
  const sectionDataRef = useRef<Record<
    string,
    Partial<Record<WorkspaceSection, Record<string, unknown>>>
  >>({})
  const loadedSectionsRef = useRef<Record<string, Set<WorkspaceSection>>>({})
  const versionsRef = useRef<Record<string, WorkspaceVersions>>({})
  const sectionFetchesRef = useRef<Record<string, Promise<WorkspaceSectionSnapshot>>>({})
  const loadedDraftsRef = useRef(new Set<string>())
  const localDraftsRef = useRef<Record<string, Partial<Client>>>({})
  const pendingPatchesRef = useRef<Record<string, Partial<Client>>>({})
  const pendingCreatesRef = useRef<Record<string, Client>>({})
  const creatingClientsRef = useRef(new Set<string>())
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const savingClientsRef = useRef(new Set<string>())
  const flushClientRef = useRef<(clientId: string, force?: boolean) => void>(() => undefined)
  const conflictRef = useRef<WorkspaceConflict | null>(null)

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  useEffect(() => {
    desiredSectionsRef.current = desiredSections
  }, [desiredSections])

  const commitClient = useCallback((client: Client) => {
    const next = [
      client,
      ...clientsRef.current.filter(item => item.id !== client.id),
    ]
    clientsRef.current = next
    setClients(next)
    return client
  }, [])

  const loadClientDraft = useCallback(async (clientId: string): Promise<Partial<Client>> => {
    if (loadedDraftsRef.current.has(clientId)) {
      return pendingPatchesRef.current[clientId] || {}
    }
    loadedDraftsRef.current.add(clientId)
    const draft = await readCachedWorkspaceDraft(storageUserId, clientId)
    if (Object.keys(draft).length === 0) return {}
    const localDraft = Object.fromEntries(
      Object.entries(draft).filter(([field]) => isLocalWorkspaceField(field as keyof Client)),
    ) as Partial<Client>
    const cloudDraft = Object.fromEntries(
      Object.entries(draft).filter(([field]) => !isLocalWorkspaceField(field as keyof Client)),
    ) as Partial<Client>
    localDraftsRef.current[clientId] = {
      ...localDraft,
      ...(localDraftsRef.current[clientId] || {}),
    }
    if (Object.keys(cloudDraft).length > 0) {
      pendingPatchesRef.current[clientId] = {
        ...cloudDraft,
        ...(pendingPatchesRef.current[clientId] || {}),
      }
    }
    const current = clientsRef.current.find(client => client.id === clientId)
    if (current) commitClient({
      ...current,
      ...(localDraftsRef.current[clientId] || {}),
      ...(pendingPatchesRef.current[clientId] || {}),
    })
    return cloudDraft
  }, [commitClient, storageUserId])

  const applySnapshot = useCallback((
    snapshot: WorkspaceSectionSnapshot,
    cache = true,
  ): Client | null => {
    const currentSections = sectionDataRef.current[snapshot.clientId] || {}
    const mergedSections = {
      ...currentSections,
      ...snapshot.sections,
    }
    if (!mergedSections.core) return null
    sectionDataRef.current[snapshot.clientId] = mergedSections
    const loaded = loadedSectionsRef.current[snapshot.clientId] || new Set<WorkspaceSection>()
    for (const section of snapshot.loadedSections) loaded.add(section)
    loadedSectionsRef.current[snapshot.clientId] = loaded
    setLoadedSectionsByClient(current => ({
      ...current,
      [snapshot.clientId]: Array.from(loaded),
    }))
    versionsRef.current[snapshot.clientId] = mergeWorkspaceVersions(
      versionsRef.current[snapshot.clientId] || emptyWorkspaceVersions(),
      snapshot.versions,
      snapshot.loadedSections,
    )
    const client = {
      ...composeClientData(mergedSections),
      ...(localDraftsRef.current[snapshot.clientId] || {}),
      ...(pendingPatchesRef.current[snapshot.clientId] || {}),
    }
    commitClient(client)
    if (cache) void writeCachedWorkspaceSections(storageUserId, snapshot)
    return client
  }, [commitClient, storageUserId])

  const applySyncedClient = useCallback((record: SyncedClient): Client | null => {
    const sections = splitClientData(record.client)
    return applySnapshot({
      clientId: record.client.id,
      sections,
      versions: record.versions,
      loadedSections: [...WORKSPACE_SECTIONS],
    })
  }, [applySnapshot])

  const fetchManifests = useCallback(async (): Promise<WorkspaceManifest[]> => {
    const params = new URLSearchParams()
    if (teamId) params.set("teamId", teamId)
    const query = params.size ? `?${params.toString()}` : ""
    const response = await fetch(`/api/workspace/client-summaries${query}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
    if (response.status === 401) {
      window.location.replace("/sign-in?redirect_url=/workspace")
      throw new Error("登录状态已失效")
    }
    const body = await response.json().catch(() => ({})) as {
      clients?: WorkspaceManifest[]
      error?: string
    }
    if (!response.ok || !Array.isArray(body.clients)) {
      throw new Error(body.error || `客户目录读取失败（HTTP ${response.status}）`)
    }
    manifestsRef.current = Object.fromEntries(
      body.clients.map(client => [client.id, client]),
    )
    setClientDirectory(body.clients.map(client => ({
      id: client.id,
      name: client.name,
    })))
    return body.clients
  }, [teamId])

  const fetchSections = useCallback(async (
    clientId: string,
    sections: readonly WorkspaceSection[],
  ): Promise<WorkspaceSectionSnapshot> => {
    const params = new URLSearchParams()
    if (teamId) params.set("teamId", teamId)
    params.set("sections", normalizeWorkspaceSections(sections).join(","))
    const response = await fetch(
      `/api/workspace/clients/${encodeURIComponent(clientId)}?${params.toString()}`,
      { cache: "no-store", credentials: "same-origin" },
    )
    const body = await response.json().catch(() => ({})) as {
      snapshot?: WorkspaceSectionSnapshot
      error?: string
    }
    if (!response.ok || !body.snapshot) {
      throw new Error(body.error || `客户模块读取失败（HTTP ${response.status}）`)
    }
    return body.snapshot
  }, [teamId])

  const ensureSections = useCallback(async (
    sections: readonly WorkspaceSection[] = desiredSectionsRef.current,
    clientId = activeIdRef.current || "",
    force = false,
  ): Promise<Client | null> => {
    if (!clientId) return null
    await loadClientDraft(clientId)
    const normalized = normalizeWorkspaceSections(sections)
    const loaded = loadedSectionsRef.current[clientId] || new Set<WorkspaceSection>()
    const manifestVersions = manifestsRef.current[clientId]?.versions
    const localVersions = versionsRef.current[clientId]
    const needed = force ? normalized : normalized.filter(section => (
      !loaded.has(section)
      || !manifestVersions
      || !localVersions
      || manifestVersions[section] !== localVersions[section]
    ))
    if (needed.length === 0) {
      return clientsRef.current.find(client => client.id === clientId) || null
    }
    setSyncState({ phase: "loading", message: "正在读取当前模块" })
    const requestKey = `${clientId}:${needed.slice().sort().join(",")}`
    const existingRequest = sectionFetchesRef.current[requestKey]
    const request = existingRequest || fetchSections(clientId, needed)
    if (!existingRequest) sectionFetchesRef.current[requestKey] = request
    try {
      const snapshot = await request
      const client = applySnapshot(snapshot)
      setSyncState({ phase: "idle", message: "当前模块已同步" })
      return client
    } finally {
      if (sectionFetchesRef.current[requestKey] === request) {
        delete sectionFetchesRef.current[requestKey]
      }
    }
  }, [applySnapshot, fetchSections, loadClientDraft])

  useEffect(() => {
    let cancelled = false
    async function hydrate() {
      let cacheApplied = false
      try {
        const initialSections = desiredSectionsRef.current
        const manifests = await fetchManifests()
        if (cancelled) return
        const preferred = restrictedClientId
          || initialClientId
          || requestedClientId()
          || getActiveId(storageUserId)
        const targetId = preferred && manifests.some(client => client.id === preferred)
          ? preferred
          : manifests[0]?.id || null
        setActiveIdState(targetId)
        persistActiveId(storageUserId, targetId)
        if (targetId) {
          const restoredDraft = await loadClientDraft(targetId)
          const cached = await readCachedWorkspaceSections(
            storageUserId,
            targetId,
            initialSections,
          )
          if (cancelled) return
          if (cached) {
            cacheApplied = Boolean(applySnapshot(cached, false))
            if (cacheApplied) setHydrated(true)
          }
          await ensureSections(initialSections, targetId)
          if (Object.keys(restoredDraft).length > 0) {
            window.setTimeout(() => flushClientRef.current(targetId), 0)
          }
        } else {
          setSyncState({ phase: "idle", message: "暂无客户资料" })
        }
      } catch (error) {
        if (cancelled) return
        setSyncState({
          phase: "error",
          message: error instanceof Error ? error.message : "客户资料读取失败",
        })
      } finally {
        if (!cancelled) setHydrated(true)
      }

      if (
        !cancelled
        && !restrictedClientId
        && !teamId
        && !isLegacyMigrationComplete(storageUserId)
        && canClaimLegacyWorkspace(storageUserId)
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
  }, [
    applySnapshot,
    ensureSections,
    fetchManifests,
    initialClientId,
    loadClientDraft,
    restrictedClientId,
    storageUserId,
    teamId,
  ])

  useEffect(() => {
    if (!hydrated || !activeId) return
    void ensureSections(desiredSections, activeId).catch(error => {
      setSyncState({
        phase: "error",
        message: error instanceof Error ? error.message : "当前模块读取失败",
      })
    })
  }, [activeId, desiredSections, ensureSections, hydrated])

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
      manifestsRef.current[client.id] = {
        id: client.id,
        name: client.name,
        updatedAt: client.updatedAt,
        versions: body.versions,
      }
      applySyncedClient(body)
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
  }, [applySyncedClient])

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
    const params = new URLSearchParams()
    if (teamId) params.set("teamId", teamId)
    const query = params.size ? `?${params.toString()}` : ""

    let didConflict = false
    try {
      const response = await fetch(
        `/api/workspace/clients/${encodeURIComponent(clientId)}${query}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patch: serializablePatch,
            unsetFields,
            expectedVersions: versionsRef.current[clientId] || emptyWorkspaceVersions(),
            force,
          }),
        },
      )
      const body = await response.json().catch(() => ({})) as {
        snapshot?: WorkspaceSectionSnapshot
        client?: Client
        versions?: WorkspaceVersions
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
      if (!response.ok) {
        throw new Error(body.error || `云端保存失败（HTTP ${response.status}）`)
      }
      if (body.snapshot) {
        applySnapshot(body.snapshot)
      } else if (body.client && body.versions) {
        applySyncedClient({ client: body.client, versions: body.versions })
      } else {
        throw new Error("云端保存响应不完整")
      }
      await acknowledgeCachedWorkspaceDraftPatch(storageUserId, clientId, patch)
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
        saveTimersRef.current[clientId] = setTimeout(
          () => flushClientRef.current(clientId),
          150,
        )
      }
    }
  }, [applySnapshot, applySyncedClient, storageUserId, teamId])

  useEffect(() => {
    flushClientRef.current = (clientId, force) => {
      void flushClient(clientId, force)
    }
  }, [flushClient])

  const scheduleSave = useCallback((clientId: string) => {
    if (saveTimersRef.current[clientId]) clearTimeout(saveTimersRef.current[clientId])
    saveTimersRef.current[clientId] = setTimeout(
      () => void flushClient(clientId),
      SAVE_DELAY_MS,
    )
  }, [flushClient])

  const handleSelect = useCallback((id: string) => {
    setActiveIdState(id)
    persistActiveId(storageUserId, id)
    void ensureSections(desiredSections, id)
  }, [desiredSections, ensureSections, storageUserId])

  const handleCreate = useCallback((
    name: string,
    subjectType: AnalysisSubjectType = "brand",
  ) => {
    if (restrictedClientId || teamId) return
    const client = createClient(name, subjectType)
    pendingCreatesRef.current[client.id] = client
    commitClient(client)
    setClientDirectory(current => [
      { id: client.id, name: client.name },
      ...current.filter(item => item.id !== client.id),
    ])
    setActiveIdState(client.id)
    persistActiveId(storageUserId, client.id)
    void persistCreate(client)
  }, [commitClient, persistCreate, restrictedClientId, storageUserId, teamId])

  const handleDelete = useCallback((id: string) => {
    if (restrictedClientId || teamId) return
    const snapshot = clientsRef.current
    const directorySnapshot = clientDirectory
    const next = snapshot.filter(client => client.id !== id)
    clientsRef.current = next
    setClients(next)
    setActiveIdState(next[0]?.id || null)
    persistActiveId(storageUserId, next[0]?.id || null)
    void (async () => {
      try {
        const response = await fetch(`/api/workspace/clients/${encodeURIComponent(id)}`, {
          method: "DELETE",
          credentials: "same-origin",
        })
        if (!response.ok && response.status !== 404) {
          const body = await response.json().catch(() => ({})) as { error?: string }
          throw new Error(body.error || `删除失败（HTTP ${response.status}）`)
        }
        delete manifestsRef.current[id]
        delete versionsRef.current[id]
        delete sectionDataRef.current[id]
        delete loadedSectionsRef.current[id]
        setLoadedSectionsByClient(current => {
          const next = { ...current }
          delete next[id]
          return next
        })
        delete pendingPatchesRef.current[id]
        delete localDraftsRef.current[id]
        await deleteCachedWorkspaceClient(storageUserId, id)
        setClientDirectory(current => current.filter(client => client.id !== id))
        setSyncState({ phase: "saved", message: "云端客户已删除", savedAt: new Date().toISOString() })
      } catch (error) {
        clientsRef.current = snapshot
        setClients(snapshot)
        setClientDirectory(directorySnapshot)
        setSyncState({ phase: "error", message: error instanceof Error ? error.message : "删除失败" })
      }
    })()
  }, [clientDirectory, restrictedClientId, storageUserId, teamId])

  const handleChangeClient = useCallback((patch: Partial<Client>) => {
    if (!activeId) return
    const clientId = activeId
    const scopedPatch = restrictedClientId
      ? Object.fromEntries(
          Object.entries(patch).filter(([field]) => (
            CLIENT_ACCOUNT_PATCH_FIELDS.has(field as keyof Client)
          )),
        ) as Partial<Client>
      : patch
    if (Object.keys(scopedPatch).length === 0) return
    const localPatch = { ...scopedPatch, updatedAt: new Date().toISOString() }
    const cloudPatch = Object.fromEntries(
      Object.entries(scopedPatch).filter(([field]) => !isLocalWorkspaceField(field as keyof Client)),
    ) as Partial<Client>
    const deviceDraft = Object.fromEntries(
      Object.entries(scopedPatch).filter(([field]) => isLocalWorkspaceField(field as keyof Client)),
    ) as Partial<Client>
    if (Object.keys(deviceDraft).length > 0) {
      localDraftsRef.current[clientId] = {
        ...(localDraftsRef.current[clientId] || {}),
        ...deviceDraft,
      }
    }
    const current = clientsRef.current.find(client => client.id === clientId)
    if (current) {
      const next = { ...current, ...localPatch }
      const split = splitClientData(next)
      const changedSectionData = Object.fromEntries(
        sectionsForClientPatch(cloudPatch)
          .map(section => [section, split[section]]),
      )
      sectionDataRef.current[clientId] = {
        ...(sectionDataRef.current[clientId] || {}),
        ...changedSectionData,
        core: split.core,
      }
      commitClient(next)
      if (typeof scopedPatch.name === "string") {
        setClientDirectory(directory => directory.map(item => (
          item.id === clientId ? { ...item, name: scopedPatch.name as string } : item
        )))
      }
    }
    if (Object.keys(cloudPatch).length > 0) {
      pendingPatchesRef.current[clientId] = {
        ...(pendingPatchesRef.current[clientId] || {}),
        ...cloudPatch,
      }
    }
    void writeCachedWorkspaceDraftPatch(storageUserId, clientId, scopedPatch)
    if (Object.keys(cloudPatch).length === 0) return
    if (shouldSaveWorkspacePatchImmediately(cloudPatch)) {
      if (saveTimersRef.current[clientId]) clearTimeout(saveTimersRef.current[clientId])
      saveTimersRef.current[clientId] = setTimeout(() => void flushClient(clientId), 0)
    } else {
      scheduleSave(clientId)
    }
  }, [activeId, commitClient, flushClient, restrictedClientId, scheduleSave, storageUserId])

  const refresh = useCallback(async () => {
    if (
      Object.keys(pendingPatchesRef.current).length > 0
      || Object.keys(pendingCreatesRef.current).length > 0
      || savingClientsRef.current.size > 0
      || conflictRef.current
    ) return
    try {
      const manifests = await fetchManifests()
      const clientId = activeId
      if (!clientId) return
      const manifest = manifests.find(item => item.id === clientId)
      if (!manifest) {
        clientsRef.current = clientsRef.current.filter(client => client.id !== clientId)
        setClients(clientsRef.current)
        setActiveIdState(manifests[0]?.id || null)
        return
      }
      const loaded = Array.from(loadedSectionsRef.current[clientId] || [])
      if (!sameVersions(manifest.versions, versionsRef.current[clientId], loaded)) {
        await ensureSections(loaded, clientId)
      }
      setSyncState(current => current.phase === "error"
        ? { phase: "idle", message: "云端数据已恢复" }
        : current)
    } catch (error) {
      setSyncState({
        phase: "error",
        message: error instanceof Error ? error.message : "同步失败",
      })
    }
  }, [activeId, ensureSections, fetchManifests])

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
        for (const clientId of Object.keys(pendingPatchesRef.current)) {
          void flushClient(clientId)
        }
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
        body: JSON.stringify({
          importId: workspaceImportId(legacyClients),
          clients: legacyClients,
        }),
      })
      const body = await response.json().catch(() => ({})) as WorkspaceImportSummary & {
        error?: string
      }
      if (!response.ok || !Array.isArray(body.clients)) {
        throw new Error(body.error || `历史数据导入失败（HTTP ${response.status}）`)
      }
      markLegacyMigrationComplete(storageUserId)
      setShowMigration(false)
      for (const record of body.clients) applySyncedClient(record)
      setClientDirectory(body.clients.map(record => ({
        id: record.client.id,
        name: record.client.name,
      })))
      const first = body.clients[0]?.client.id || null
      if (first) {
        setActiveIdState(first)
        persistActiveId(storageUserId, first)
      }
      const duplicateText = body.duplicatedCount > 0
        ? `，${body.duplicatedCount} 个冲突客户已保留副本`
        : ""
      setSyncState({
        phase: "saved",
        message: `已同步 ${body.importedCount} 个本机客户${duplicateText}`,
        savedAt: new Date().toISOString(),
      })
    } catch (error) {
      setSyncState({
        phase: "error",
        message: error instanceof Error ? error.message : "历史数据导入失败",
      })
    }
  }, [applySyncedClient, legacyClients, storageUserId])

  const loadCloudConflictVersion = useCallback(() => {
    if (!conflict) return
    delete pendingPatchesRef.current[conflict.clientId]
    void acknowledgeCachedWorkspaceDraftPatch(
      storageUserId,
      conflict.clientId,
      conflict.localPatch,
    )
    applySyncedClient(conflict.current)
    conflictRef.current = null
    setConflict(null)
    setSyncState({ phase: "idle", message: "已加载云端最新版本" })
  }, [applySyncedClient, conflict, storageUserId])

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
    clientDirectory,
    activeId,
    loadedSections: activeId ? loadedSectionsByClient[activeId] || [] : [],
    hydrated,
    syncState,
    conflict,
    showMigration,
    legacyClientCount: legacyClients.length,
    handleSelect,
    handleCreate,
    handleDelete,
    handleChangeClient,
    ensureSections,
    retry,
    importLegacy,
    dismissMigration: () => setShowMigration(false),
    loadCloudConflictVersion,
    overwriteCloudConflictVersion,
  }
}
