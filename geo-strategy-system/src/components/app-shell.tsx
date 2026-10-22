"use client"

import customerStyle from "./reports/effect-dashboard.module.css"

import { useState, useCallback, useEffect, useRef } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import WorkspaceSidebar, {
  DASHBOARD_MODULES,
  isDashboardModuleKey,
  type DashboardModuleKey,
} from "@/components/sidebar/workspace-sidebar"
import { WorkspaceFrame } from "@/components/workspace-frame"
import { WorkspaceHeader } from "@/components/workspace-header"
import {
  AlertTriangle,
  ArrowUp,
  Cloud,
  GraduationCap,
  LockKeyhole,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { useCredits } from "@/components/credits/credits-provider"
import { useWorkspaceSync } from "@/hooks/use-workspace-sync"
import type {
  Client,
  ReportExportPreset,
  SystemOutputModule,
  WorkspaceAccountAccess,
} from "@/types"
import { getClientSubjectType, getSubjectCopy } from "@/lib/analysis-subject"
import { hasTeamPermission } from "@/lib/team-permissions"
import {
  WORKSPACE_SECTIONS,
  type WorkspaceSection,
} from "@/lib/workspace-sync"
import {
  WORKSPACE_NAVIGATION_EVENT,
  parseWorkspaceNavigation,
  resolveInitialWorkspaceModule,
  type WorkspaceNavigationTarget,
} from "@/lib/workspace-navigation"

const PenetrationModule = dynamic(
  () => import("@/components/penetration/penetration-module"),
  { loading: ModuleLoading },
)
const ResearchModule = dynamic(
  () => import("@/components/research/research-module"),
  { loading: ModuleLoading },
)
const DiagnosisModule = dynamic(
  () => import("@/components/diagnosis/diagnosis-module"),
  { loading: ModuleLoading },
)
const DifficultyAssessmentModule = dynamic(
  () => import("@/components/difficulty/difficulty-assessment-module"),
  { loading: ModuleLoading },
)
const KeywordStrategyModule = dynamic(
  () => import("@/components/keyword/keyword-strategy-module"),
  { loading: ModuleLoading },
)
const ArticleGenerationModule = dynamic(
  () => import("@/components/article/article-generation-module"),
  { loading: ModuleLoading },
)
const ClientFeedbackModule = dynamic(
  () => import("@/components/client-feedback/client-feedback-module"),
  { loading: ModuleLoading },
)
const ReportExportDialog = dynamic(
  () => import("@/components/reports/report-export-dialog"),
)
const ReportHistoryDialog = dynamic(
  () => import("@/components/reports/report-history-dialog"),
)

function ModuleLoading() {
  return (
    <div className="flex min-h-[420px] items-center justify-center text-sm text-slate-500">
      <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-[#1677FF]" />
      正在载入当前模块
    </div>
  )
}

function sectionsForDashboardModule(module: DashboardModuleKey): WorkspaceSection[] {
  switch (module) {
    case "penetration":
      return ["core", "penetration", "jobs"]
    case "research":
      return ["core", "knowledgeBase", "research", "jobs"]
    case "diagnosis":
      return ["core", "knowledgeBase", "diagnosis", "jobs"]
    case "difficulty":
      return ["core", "knowledgeBase", "difficulty", "jobs"]
    case "keyword":
      return ["core", "knowledgeBase", "keywordStrategy", "jobs"]
    case "article":
      return ["core", "knowledgeBase", "keywordStrategy", "articleGeneration", "jobs"]
    case "feedback":
      return ["core"]
  }
}

export default function Home({
  userId,
  access,
  adminNotifier,
  taskNotifier,
  userNotifier,
  initialNavigation,
}: {
  userId: string
  access: WorkspaceAccountAccess
  adminNotifier?: React.ReactNode
  taskNotifier?: React.ReactNode
  userNotifier?: React.ReactNode
  initialNavigation?: WorkspaceNavigationTarget
}) {
  const restricted = access.mode === "client"
  const canViewModule = useCallback((module: DashboardModuleKey) => {
    if (access.mode === "standard") return true
    if (access.mode === "team") {
      return hasTeamPermission(access.permissionKeys || [], module, "view")
    }
    if (module === "penetration" || module === "feedback") {
      return hasTeamPermission(access.permissionKeys || [], module, "view")
    }
    return true
  }, [access.mode, access.permissionKeys])
  const canViewPenetrationHistory = access.mode === "standard"
    || hasTeamPermission(access.permissionKeys || [], "penetration", "view")
  const canViewPdfHistory = access.mode === "standard"
    || (
      access.mode === "team"
      && hasTeamPermission(access.permissionKeys || [], "report", "view")
    )
  const systemOutputModules = ([
    "research",
    "diagnosis",
    "difficulty",
  ] as SystemOutputModule[]).filter(module => (
    access.mode === "standard"
    || hasTeamPermission(access.permissionKeys || [], module, "view")
  ))
  const canOpenReportHistory = canViewPenetrationHistory
    || canViewPdfHistory
    || systemOutputModules.length > 0
  const initialModule = restricted && canViewModule("feedback")
    ? "feedback"
    : DASHBOARD_MODULES.find(module => canViewModule(module.key))?.key || "penetration"
  const [activeModule, setActiveModule] = useState<DashboardModuleKey>(() => (
    resolveInitialWorkspaceModule(initialNavigation?.module, canViewModule, initialModule)
  ))
  const {
    monthlyBalance,
    monthlyAllowance,
  } = useCredits()
  const {
    clients,
    clientDirectory,
    activeId,
    loadedSections,
    hydrated,
    syncState,
    conflict,
    showMigration,
    legacyClientCount,
    handleSelect: selectClient,
    handleChangeClient,
    ensureSections,
    retry,
    importLegacy,
    dismissMigration,
    loadCloudConflictVersion,
    overwriteCloudConflictVersion,
  } = useWorkspaceSync(userId, {
    restrictedClientId: restricted ? access.clientId : undefined,
    teamId: access.mode === "team" ? access.teamId : undefined,
    initialClientId: initialNavigation?.clientId,
    sections: sectionsForDashboardModule(activeModule),
  })
  // 移动端抽屉开关。桌面端 (md+) Sidebar 永远可见，该状态被忽略。
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [reportExportPreset, setReportExportPreset] = useState<ReportExportPreset | null>(null)
  const [reportExportClient, setReportExportClient] = useState<Client | null>(null)
  const [reportHistoryOpen, setReportHistoryOpen] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [resultRefreshKey, setResultRefreshKey] = useState(0)
  const mainScrollRef = useRef<HTMLElement>(null)

  const active = clients.find(c => c.id === activeId) ?? null
  const activeDirectoryEntry = clientDirectory.find(client => client.id === activeId)
  const requiredSections = sectionsForDashboardModule(activeModule)
  const activeSectionsReady = requiredSections.every(section => loadedSections.includes(section))

  const clearResultTarget = useCallback(() => {
    const url = new URL(window.location.href)
    url.searchParams.delete("view")
    url.searchParams.delete("jobId")
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
  }, [])

  const handleModuleChange = useCallback((module: DashboardModuleKey) => {
    if (!canViewModule(module)) return
    clearResultTarget()
    setActiveModule(module)
    setSidebarOpen(false)
    setReportExportPreset(null)
    setReportExportClient(null)
    setReportHistoryOpen(false)
  }, [canViewModule, clearResultTarget])

  useEffect(() => {
    const navigate = (urlValue: string, updateHistory: boolean, forceRefresh = false) => {
      const targetUrl = new URL(urlValue, window.location.origin)
      const target = parseWorkspaceNavigation(targetUrl)
      const nextModule = target.module && isDashboardModuleKey(target.module) && canViewModule(target.module)
        ? target.module
        : activeModule
      if (nextModule !== activeModule) setActiveModule(nextModule)
      if (target.clientId && clientDirectory.some(client => client.id === target.clientId)) {
        selectClient(target.clientId)
        void ensureSections(sectionsForDashboardModule(nextModule), target.clientId, forceRefresh)
          .then(() => {
            if (forceRefresh) setResultRefreshKey(current => current + 1)
          })
      }
      if (updateHistory) {
        window.history.pushState({}, "", `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`)
      }
    }
    const onWorkspaceNavigation = (event: Event) => {
      const detail = (event as CustomEvent<{
        url?: string
        forceRefresh?: boolean
        updateHistory?: boolean
      }>).detail
      if (detail?.url) navigate(
        detail.url,
        detail.updateHistory !== false,
        Boolean(detail.forceRefresh),
      )
    }
    const onPopState = () => navigate(window.location.href, false)
    window.addEventListener(WORKSPACE_NAVIGATION_EVENT, onWorkspaceNavigation)
    window.addEventListener("popstate", onPopState)
    return () => {
      window.removeEventListener(WORKSPACE_NAVIGATION_EVENT, onWorkspaceNavigation)
      window.removeEventListener("popstate", onPopState)
    }
  }, [activeModule, canViewModule, clientDirectory, ensureSections, selectClient])

  useEffect(() => {
    if (!hydrated) return
    const url = new URL(window.location.href)
    if (activeId) url.searchParams.set("clientId", activeId)
    else url.searchParams.delete("clientId")
    url.searchParams.set("module", activeModule)
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
  }, [activeId, activeModule, hydrated])

  useEffect(() => {
    const scrollContainer = mainScrollRef.current
    if (!scrollContainer) return
    const updateVisibility = () => setShowBackToTop(scrollContainer.scrollTop > 500)
    updateVisibility()
    scrollContainer.addEventListener("scroll", updateVisibility, { passive: true })
    return () => scrollContainer.removeEventListener("scroll", updateVisibility)
  }, [])

  const scrollToTop = useCallback(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    mainScrollRef.current?.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" })
  }, [])

  return (
    <WorkspaceFrame
      className={restricted ? customerStyle.customerShell : ""}
      sidebarOpen={sidebarOpen}
      onCloseSidebar={() => setSidebarOpen(false)}
      mainRef={mainScrollRef}
      sidebar={
        <WorkspaceSidebar
          active={activeModule}
          onChange={handleModuleChange}
          client={active}
          access={access}
          monthlyCredits={monthlyBalance}
          monthlyAllowance={monthlyAllowance}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      }
      header={
        <WorkspaceHeader
          title={active?.name || "市场情报工作台"}
          subtitle={access.mode === "client"
            ? "客户专属工作台 · GEO 全链路操作工具"
            : access.mode === "team"
              ? `${access.teamName || "团队空间"} · GEO 全链路协作`
            : `${active?.industry ? `${active.industry} · ` : ""}GEO 全链路操作工具`}
          helpHref={`/help#module-${activeModule}`}
          onOpenSidebar={() => setSidebarOpen(true)}
          onExportReport={active && access.canCreateReports ? () => {
            void ensureSections(WORKSPACE_SECTIONS).then(fullClient => {
              if (!fullClient) return
              setReportExportClient(fullClient)
              setReportExportPreset({})
            })
          } : undefined}
          onOpenReportHistory={canOpenReportHistory ? () => setReportHistoryOpen(true) : undefined}
          syncState={syncState}
          onRetrySync={retry}
          access={access}
          adminNotifier={adminNotifier}
          taskNotifier={taskNotifier}
          userNotifier={userNotifier}
        />
      }
      overlays={
        <>
          {showBackToTop ? (
            <button
              type="button"
              onClick={scrollToTop}
              className="no-print fixed bottom-5 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[#1677FF] to-[#00AEEA] text-white shadow-[0_14px_34px_-12px_rgba(0,119,255,0.82)] ring-1 ring-white/70 transition hover:-translate-y-0.5 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1677FF] focus-visible:ring-offset-2 sm:bottom-7 sm:right-7"
              aria-label="回到页面顶部"
              title="回到顶部"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          ) : null}
          {access.canCreateReports && (reportExportClient || active) && reportExportPreset && (
            <ReportExportDialog
              client={(reportExportClient || active) as Client}
              teamId={access.mode === "team" ? access.teamId : undefined}
              preset={reportExportPreset}
              onClose={() => {
                setReportExportPreset(null)
                setReportExportClient(null)
              }}
            />
          )}
          {reportHistoryOpen && canOpenReportHistory ? (
            <ReportHistoryDialog
              clients={clientDirectory}
              activeClientId={activeId}
              teamId={access.mode === "team" ? access.teamId : undefined}
              showPenetrationHistory={canViewPenetrationHistory}
              showRawAnswers={access.penetrationResultDetail !== "summary"}
              canManagePenetrationHistory={access.mode !== "client"}
              systemOutputModules={systemOutputModules}
              showPdfHistory={canViewPdfHistory}
              onExportPenetration={access.canCreateReports
                ? historyClient => {
                    setReportHistoryOpen(false)
                    setReportExportClient(historyClient)
                    setReportExportPreset({ kind: "penetration" })
                  }
                : undefined}
              onClose={() => setReportHistoryOpen(false)}
            />
          ) : null}
          {showMigration ? (
            <LegacyMigrationDialog
              count={legacyClientCount}
              onImport={() => void importLegacy()}
              onDismiss={dismissMigration}
            />
          ) : null}
        </>
      }
    >
      {conflict ? (
        <WorkspaceConflictNotice
          onLoadCloud={loadCloudConflictVersion}
          onOverwriteCloud={overwriteCloudConflictVersion}
        />
      ) : null}
      {!hydrated ? (
        <div className="h-screen flex items-center justify-center text-slate-400 text-sm">
          加载中...
        </div>
      ) : !active && activeDirectoryEntry ? (
        <ModuleLoading />
      ) : !active ? (
        <EmptyState access={access} />
      ) : !activeSectionsReady ? (
        <ModuleLoading />
      ) : (
        // key={active.id}：切换客户时强制 Dashboard 整子树重挂载，
        // 彻底清空各 Module 内的 isDetecting/loading/progress 等运行时状态，根治状态泄露。
        <Dashboard
          key={`${active.id}:${resultRefreshKey}`}
          client={active}
          onChangeClient={handleChangeClient}
          access={access}
          activeModule={activeModule}
          onExportReport={preset => {
            void ensureSections(WORKSPACE_SECTIONS).then(fullClient => {
              if (!fullClient) return
              setReportExportClient(fullClient)
              setReportExportPreset(preset)
            })
          }}
        />
      )}
    </WorkspaceFrame>
  )
}

function WorkspaceConflictNotice({
  onLoadCloud,
  onOverwriteCloud,
}: {
  onLoadCloud: () => void
  onOverwriteCloud: () => void
}) {
  return (
    <div className="no-print border-b border-amber-200 bg-amber-50 text-amber-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-8">
        <div className="flex min-w-0 items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs leading-5">
            另一台设备已更新当前模块，本机内容尚未覆盖云端。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onLoadCloud}
            className="h-8 rounded-md border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            加载云端版本
          </button>
          <button
            type="button"
            onClick={onOverwriteCloud}
            className="h-8 rounded-md bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700"
          >
            保留本机版本
          </button>
        </div>
      </div>
    </div>
  )
}

function LegacyMigrationDialog({
  count,
  onImport,
  onDismiss,
}: {
  count: number
  onImport: () => void
  onDismiss: () => void
}) {
  return (
    <div className="no-print fixed inset-0 z-[80] flex items-center justify-center bg-[#00133F]/58 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="legacy-migration-title"
        className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-[0_30px_90px_-28px_rgba(0,29,102,0.72)] ring-1 ring-[#8AC8FF]"
      >
        <div className="bg-gradient-to-r from-[#075BDB] via-[#1677FF] to-[#00AEEA] px-5 py-4 text-white">
          <div className="flex items-center gap-2 text-xs font-semibold text-cyan-100">
            <Cloud className="h-4 w-4" />
            云端工作区
          </div>
          <h2 id="legacy-migration-title" className="mt-2 text-lg font-semibold">
            发现 {count} 个本机历史客户
          </h2>
        </div>
        <div className="px-5 py-5">
          <p className="text-sm leading-7 text-slate-600">
            确认后会将这些数据归入当前登录账号。同名或冲突数据会保留副本，不会覆盖云端内容。
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="h-10 rounded-lg px-4 text-sm font-medium text-slate-500 hover:bg-slate-100"
            >
              稍后处理
            </button>
            <button
              type="button"
              onClick={onImport}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-[#126BEB] to-[#00AEEA] px-4 text-sm font-semibold text-white shadow-[0_14px_28px_-18px_rgba(0,119,255,0.9)] hover:brightness-105"
            >
              <Cloud className="h-4 w-4" />
              同步到当前账号
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ access }: { access: WorkspaceAccountAccess }) {
  const restricted = access.mode === "client"
  const teamSpace = access.mode === "team"
  const canManageTeam = access.teamRole === "owner" || access.teamRole === "admin"
  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col items-center justify-center px-6 py-16 animate-fade-in-up">
      <div className="mb-7 flex h-20 w-20 items-center justify-center rounded-lg bg-gradient-to-br from-[#2F54EB] via-[#1677FF] to-[#00C8FF] shadow-[0_18px_40px_-22px_rgba(22,119,255,0.72)]">
        <Sparkles className="h-12 w-12 text-white" />
      </div>
      <h2 className="geo-display-title text-center text-2xl text-slate-900 sm:text-3xl">
        {restricted
          ? "客户面板暂不可用"
          : teamSpace
            ? "团队暂未共享客户档案"
            : "还没有可用的客户档案"}
      </h2>
      <p className="text-sm text-slate-500 mt-3 max-w-md text-center leading-relaxed">
        {restricted
          ? `当前账号已关联「${access.clientName || "指定客户"}」，但面板数据暂时无法读取。请联系管理员检查授权客户是否仍然存在。`
          : teamSpace
            ? canManageTeam
              ? "请在团队协作中选择自己的客户档案并共享给成员，授权后会立即出现在团队工作台。"
              : "团队所有者尚未向你开放客户档案，或原有共享已被收回。请联系团队管理员调整授权。"
            : "客户资料已统一移到“我的主页”管理。新建或选择客户后，即可进入对应工作台。"}
      </p>
      {!restricted ? (
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={teamSpace ? "/account?tab=teams" : "/account?tab=clients"}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-5 text-xs font-semibold text-white shadow-sm"
          >
            {teamSpace ? "打开团队协作" : "管理我的客户"}
          </Link>
          <Link href="/workspace/tutorial?manual=1" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#B7D9FF] bg-white px-4 text-xs font-semibold text-[#0958D9]"><GraduationCap className="h-4 w-4" />新手体验教程</Link>
        </div>
      ) : null}
    </div>
  )
}

function Dashboard({
  client,
  onChangeClient,
  onExportReport,
  access,
  activeModule,
}: {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
  onExportReport: (preset: ReportExportPreset) => void
  access: WorkspaceAccountAccess
  activeModule: DashboardModuleKey
}) {
  const subjectType = getClientSubjectType(client)
  const subjectCopy = getSubjectCopy(subjectType)
  const teamCanOperate = access.mode !== "team"
    || (
      !access.teamReadOnly
      && (
        hasTeamPermission(access.permissionKeys || [], activeModule, "execute")
        || hasTeamPermission(access.permissionKeys || [], activeModule, "edit")
        || hasTeamPermission(access.permissionKeys || [], activeModule, "manage")
      )
    )
  const readOnlyModule = (access.mode === "client"
    && activeModule !== "penetration"
    && activeModule !== "feedback") || !teamCanOperate
  const moduleOnChange = readOnlyModule ? () => undefined : onChangeClient

  return (
    <div className="geo-page-wrap animate-fade-in-up py-3 md:py-4 print-container">
      {!(access.mode === "client" && activeModule === "feedback") && <header className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div>
          <div className="mb-1 text-xs text-slate-600">
            当前客户 · {subjectCopy.modeLabel}
          </div>
          <h1 className="break-words text-xl font-semibold text-slate-900">
            {client.name}
          </h1>
          {client.industry && (
            <span className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-slate-600">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00C8FF]"></span>
              {client.industry}
            </span>
          )}
          {access.mode === "client" ? (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
              <LockKeyhole className="h-3 w-3" />
              客户专属授权
            </span>
          ) : null}
          {access.mode === "team" ? (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
              <ShieldCheck className="h-3 w-3" />
              {access.teamName || "团队协作"} · {access.teamRole === "owner" ? "所有者" : access.teamRole === "admin" ? "管理员" : "成员"}
            </span>
          ) : null}
        </div>
        <div className="text-xs text-slate-600">
          创建于 {new Date(client.createdAt).toLocaleDateString("zh-CN")}
        </div>
        </div>
      </header>}

      <section className="mt-1 md:mt-2">
        {readOnlyModule ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-[#91CAFF] bg-[#EAF5FF] px-3 py-2.5 text-xs leading-5 text-[#0958D9] no-print">
            <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {access.mode === "team"
              ? "当前成员在本模块只有查看权限。需要执行或编辑时，请联系团队所有者调整模块权限。"
              : "当前为查看模式，可阅读本项目已有结果。需要补充资料、重新生成或执行下一步时，请联系项目负责人。"}
          </div>
        ) : null}
        <fieldset
          disabled={readOnlyModule}
          aria-disabled={readOnlyModule}
          className={readOnlyModule ? "min-w-0 opacity-[0.92]" : "min-w-0"}
          onClickCapture={event => {
            if (!readOnlyModule) return
            const target = event.target as HTMLElement
            if (target.closest("a,button,input,textarea,select,[role='button']")) {
              event.preventDefault()
              event.stopPropagation()
            }
          }}
        >
        {activeModule === "penetration" && (
          <PenetrationModule
            client={client}
            onChangeClient={onChangeClient}
            identityReadOnly={!access.canManageClientIdentity}
            questionReadOnly={
              (access.mode === "team" || access.mode === "client")
              && !hasTeamPermission(
                access.permissionKeys || [],
                "penetration",
                "edit",
              )
            }
            canExecute={access.canRunPenetration}
            canManageAutomation={
              access.mode === "standard"
              || hasTeamPermission(access.permissionKeys || [], "penetration", "manage")
            }
            teamId={access.mode === "team" ? access.teamId : undefined}
          />
        )}
        {activeModule === "research" && (
          <ResearchModule client={client} onChangeClient={moduleOnChange} />
        )}
        {activeModule === "diagnosis" && (
          <DiagnosisModule client={client} onChangeClient={moduleOnChange} />
        )}
        {activeModule === "difficulty" && (
          <DifficultyAssessmentModule
            client={client}
            onChangeClient={moduleOnChange}
            onExportReport={onExportReport}
          />
        )}
        {activeModule === "keyword" && (
          <KeywordStrategyModule
            client={client}
            onChangeClient={moduleOnChange}
            onExportReport={access.canCreateReports ? () => onExportReport({ kind: "keyword" }) : undefined}
          />
        )}
        {activeModule === "article" && (
          <ArticleGenerationModule client={client} onChangeClient={moduleOnChange} />
        )}
        {activeModule === "feedback" && (
          <ClientFeedbackModule client={client} />
        )}
        </fieldset>
      </section>
    </div>
  )
}
