"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import Image from "next/image"
import Link from "next/link"
import ClientSidebar from "@/components/sidebar/client-sidebar"
import PenetrationModule from "@/components/penetration/penetration-module"
import ResearchModule from "@/components/research/research-module"
import DiagnosisModule from "@/components/diagnosis/diagnosis-module"
import KeywordStrategyModule from "@/components/keyword/keyword-strategy-module"
import ArticleGenerationModule from "@/components/article/article-generation-module"
import DifficultyAssessmentModule from "@/components/difficulty/difficulty-assessment-module"
import ClientFeedbackModule from "@/components/client-feedback/client-feedback-module"
import ReportExportDialog from "@/components/reports/report-export-dialog"
import ReportHistoryDialog from "@/components/reports/report-history-dialog"
import SiteFooter from "@/components/site-footer"
import {
  AlertTriangle,
  ArrowUp,
  Brain,
  Building2,
  CalendarRange,
  CheckCircle2,
  Cloud,
  CloudOff,
  ChevronDown,
  FileDown,
  FileText,
  Gauge,
  Grid3X3,
  History,
  ListOrdered,
  LockKeyhole,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Radar,
  RefreshCw,
  Sparkles,
  Target,
  UserRound,
} from "lucide-react"
import { useCredits } from "@/components/credits/credits-provider"
import { RechargeButton } from "@/components/credits/recharge-button"
import { AccountMenu } from "@/components/auth/account-menu"
import { useWorkspaceSync, type WorkspaceSyncState } from "@/hooks/use-workspace-sync"
import type {
  AnalysisSubjectType,
  Client,
  ReportExportPreset,
  WorkspaceAccountAccess,
} from "@/types"
import { getClientSubjectType, getSubjectCopy } from "@/lib/analysis-subject"

export default function Home({
  userId,
  access,
}: {
  userId: string
  access: WorkspaceAccountAccess
}) {
  const restricted = access.mode === "client"
  const {
    monthlyBalance,
    monthlyAllowance,
  } = useCredits()
  const {
    clients,
    activeId,
    hydrated,
    syncState,
    conflict,
    showMigration,
    legacyClientCount,
    handleSelect: selectClient,
    handleCreate: createWorkspaceClient,
    handleDelete,
    handleChangeClient,
    retry,
    importLegacy,
    dismissMigration,
    loadCloudConflictVersion,
    overwriteCloudConflictVersion,
  } = useWorkspaceSync(userId, {
    restrictedClientId: restricted ? access.clientId : undefined,
  })
  // 移动端抽屉开关。桌面端 (md+) Sidebar 永远可见，该状态被忽略。
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [reportExportPreset, setReportExportPreset] = useState<ReportExportPreset | null>(null)
  const [reportExportClient, setReportExportClient] = useState<Client | null>(null)
  const [reportHistoryOpen, setReportHistoryOpen] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const mainScrollRef = useRef<HTMLElement>(null)

  const active = clients.find(c => c.id === activeId) ?? null

  const handleSelect = useCallback((id: string) => {
    selectClient(id)
    // 移动端：选中客户后自动收起抽屉，直接进入详情面板
    setSidebarOpen(false)
    setReportExportPreset(null)
    setReportExportClient(null)
    setReportHistoryOpen(false)
  }, [selectClient])

  const handleCreate = useCallback((name: string, subjectType: AnalysisSubjectType = "brand") => {
    createWorkspaceClient(name, subjectType)
    setSidebarOpen(false)
  }, [createWorkspaceClient])

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
    <div className="flex h-screen w-screen overflow-hidden geo-workspace-bg print-root">
      {/* 移动端：抽屉展开时的半透明遮罩，点击关闭 */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-40 no-print"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <ClientSidebar
        clients={clients}
        activeId={activeId}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onDelete={handleDelete}
        restricted={restricted}
        monthlyCredits={monthlyBalance}
        monthlyAllowance={monthlyAllowance}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main ref={mainScrollRef} className="flex-1 min-w-0 h-screen overflow-y-auto overscroll-contain relative print-main">
        <div className="relative z-10">
        <StickyHeader
          client={active}
          onOpenSidebar={() => setSidebarOpen(true)}
          onExportReport={() => {
            setReportExportClient(null)
            setReportExportPreset({})
          }}
          onOpenReportHistory={() => setReportHistoryOpen(true)}
          syncState={syncState}
          onRetrySync={retry}
          access={access}
        />
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
        ) : !active ? (
          <EmptyState
            onCreate={handleCreate}
            restricted={restricted}
            clientName={access.clientName}
          />
        ) : (
          // key={active.id}：切换客户时强制 Dashboard 整子树重挂载，
          // 彻底清空各 Module 内的 isDetecting/loading/progress 等运行时状态，根治状态泄露。
          <Dashboard
            key={active.id}
            client={active}
            onChangeClient={handleChangeClient}
            access={access}
            onExportReport={preset => {
              setReportExportClient(null)
              setReportExportPreset(preset)
            }}
          />
        )}
        <SiteFooter />
        </div>
      </main>
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
          preset={reportExportPreset}
          onClose={() => {
            setReportExportPreset(null)
            setReportExportClient(null)
          }}
        />
      )}
      {reportHistoryOpen ? (
        <ReportHistoryDialog
          clients={clients}
          activeClientId={activeId}
          onExportPenetration={historyClient => {
            setReportHistoryOpen(false)
            setReportExportClient(historyClient)
            setReportExportPreset({ kind: "penetration" })
          }}
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
    </div>
  )
}

function StickyHeader({
  client,
  onOpenSidebar,
  onExportReport,
  onOpenReportHistory,
  syncState,
  onRetrySync,
  access,
}: {
  client: Client | null
  onOpenSidebar: () => void
  onExportReport: () => void
  onOpenReportHistory: () => void
  syncState: WorkspaceSyncState
  onRetrySync: () => void
  access: WorkspaceAccountAccess
}) {
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false)

  return (
    <header className="sticky-header sticky top-0 z-30 border-b border-white/10 bg-[#001D66]/96 text-white shadow-[0_12px_30px_-24px_rgba(0,29,102,0.88)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-2 px-3 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* 移动端汉堡按钮：触发左侧抽屉。md+ 隐藏 */}
          <button
            onClick={onOpenSidebar}
            className="no-print -ml-1 shrink-0 rounded-lg p-2 transition hover:bg-white/10 md:hidden"
            aria-label="打开客户列表"
          >
            <Menu className="h-5 w-5 text-white" />
          </button>
          <Link
            href="/"
            title="返回势途 GEO 品牌主页"
            className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            <Image
              src="/brand/shitu-lockup.jpg"
              alt="势途"
              width={840}
              height={960}
              sizes="32px"
              priority
              className="h-8 w-auto rounded-md bg-white ring-1 ring-white/20"
            />
          </Link>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white sm:text-base">
              <span className="hidden sm:inline">势途 GEO · </span>
              {client?.name || "市场情报工作台"}
            </div>
            <div className="hidden truncate text-[10px] text-white/58 sm:block">
              {access.mode === "client"
                ? "客户专属工作台 · GEO 全链路操作工具"
                : `${client?.industry ? `${client.industry} · ` : ""}GEO 全链路操作工具`}
            </div>
          </div>
        </div>

        <div className="no-print hidden items-center gap-2 lg:flex">
          <button
            type="button"
            onClick={onOpenReportHistory}
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/20 bg-white/8 px-3 text-xs font-semibold text-white transition hover:bg-white/14"
            title="查看历史专业报告"
          >
            <History className="h-3.5 w-3.5" />
            历史报告
          </button>
          {client && access.canCreateReports && (
            <button
              onClick={onExportReport}
              className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#69DFFF]/65 bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 text-xs font-semibold text-white shadow-[0_10px_24px_-16px_rgba(0,200,255,0.8)] transition-[filter] hover:brightness-105"
            >
              <FileDown className="h-3.5 w-3.5" />
              导出报告
            </button>
          )}
        </div>

        <div className="no-print flex shrink-0 items-center gap-1.5">
          <div className="hidden xl:block">
            <WorkspaceSyncIndicator state={syncState} onRetry={onRetrySync} />
          </div>
          <CreditsPill />
          <RechargeButton />
          <div className="relative lg:hidden">
            <button
              type="button"
              onClick={() => setMobileActionsOpen(open => !open)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/18 bg-white/8 text-white transition hover:bg-white/14"
              aria-label="更多工作台操作"
              aria-expanded={mobileActionsOpen}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {mobileActionsOpen ? (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  aria-label="关闭更多操作"
                  onClick={() => setMobileActionsOpen(false)}
                />
                <div className="absolute right-0 top-11 z-50 w-48 overflow-hidden rounded-lg border border-[#C8D7E8] bg-white p-1.5 text-[#38536E] shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      onOpenReportHistory()
                      setMobileActionsOpen(false)
                    }}
                    className="flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-xs font-semibold hover:bg-[#EEF5FC]"
                  >
                    <History className="h-4 w-4 text-[#1677FF]" />
                    历史专业报告
                  </button>
                  {client && access.canCreateReports ? (
                    <button
                      type="button"
                      onClick={() => {
                        onExportReport()
                        setMobileActionsOpen(false)
                      }}
                      className="flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-xs font-semibold hover:bg-[#EEF5FC]"
                    >
                      <FileDown className="h-4 w-4 text-[#1677FF]" />
                      导出专业报告
                    </button>
                  ) : null}
                  {syncState.phase === "error" ? (
                    <button
                      type="button"
                      onClick={() => {
                        onRetrySync()
                        setMobileActionsOpen(false)
                      }}
                      className="flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      <RefreshCw className="h-4 w-4" />
                      重试云端同步
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}

function WorkspaceSyncIndicator({
  state,
  onRetry,
}: {
  state: WorkspaceSyncState
  onRetry: () => void
}) {
  const isBusy = state.phase === "loading" || state.phase === "saving"
  const isError = state.phase === "error" || state.phase === "conflict"
  const Icon = isBusy
    ? LoaderCircle
    : isError
      ? CloudOff
      : state.phase === "saved"
        ? CheckCircle2
        : Cloud
  const label = state.phase === "loading"
    ? "云端读取中"
    : state.phase === "saving"
      ? "云端保存中"
      : state.phase === "error"
        ? "同步失败"
        : state.phase === "conflict"
          ? "需要处理冲突"
          : "云端已同步"

  if (state.phase === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        title={`${state.message}，点击重试`}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-400/15 px-2 text-[11px] font-medium text-rose-100 ring-1 ring-rose-300/30 transition-colors hover:bg-rose-400/25"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        <span className="hidden lg:inline">{label}</span>
      </button>
    )
  }

  return (
    <div
      title={state.message}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium ring-1 ${
        isError
          ? "bg-amber-300/15 text-amber-100 ring-amber-200/30"
          : "bg-cyan-300/12 text-cyan-50 ring-cyan-200/25"
      }`}
    >
      <Icon className={`h-3.5 w-3.5 ${isBusy ? "animate-spin" : ""}`} />
      <span className="hidden lg:inline">{label}</span>
    </div>
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

function CreditsPill() {
  const {
    balance,
    unlimited,
    monthlyBalance,
    monthlyAllowance,
    permanentBalance,
  } = useCredits()
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-lg bg-[#FFB020]/16 px-2.5 py-1.5 text-[11px] font-medium text-white ring-1 ring-[#FFB020]/35"
      title={monthlyAllowance > 0
        ? `本月专属额度 ${monthlyBalance}/${monthlyAllowance}，充值积分 ${permanentBalance ?? 0}`
        : "体验算力积分余额"}
    >
      <Sparkles className="h-3.5 w-3.5 text-amber-300" />
      <span className="hidden sm:inline text-white/60">积分</span>
      <span className="font-mono font-bold text-white tabular-nums">
        {unlimited ? "无限" : balance === null ? "…" : balance}
      </span>
    </div>
  )
}

function EmptyState({
  onCreate,
  restricted = false,
  clientName,
}: {
  onCreate: (name: string, subjectType?: AnalysisSubjectType) => void
  restricted?: boolean
  clientName?: string
}) {
  const [name, setName] = useState("")
  const [subjectType, setSubjectType] = useState<AnalysisSubjectType>("brand")
  return (
    <div className="h-screen flex flex-col items-center justify-center px-6 animate-fade-in-up">
      <div className="mb-7 flex h-20 w-20 items-center justify-center rounded-lg bg-gradient-to-br from-[#2F54EB] via-[#1677FF] to-[#00C8FF] shadow-[0_18px_40px_-22px_rgba(22,119,255,0.72)]">
        <Sparkles className="h-12 w-12 text-white" />
      </div>
      <h2 className="geo-display-title text-3xl text-slate-900">
        {restricted ? "客户面板暂不可用" : "欢迎使用势途 GEO 市场情报终端"}
      </h2>
      <p className="text-sm text-slate-500 mt-3 max-w-md text-center leading-relaxed">
        {restricted
          ? `当前账号已关联「${clientName || "指定客户"}」，但面板数据暂时无法读取。请联系管理员检查授权客户是否仍然存在。`
          : "每个客户的调研数据、诊断结果与生成策略会自动保存到当前账号，换设备也能继续使用。"}
      </p>
      {!restricted ? <div className="mt-8 w-full max-w-md space-y-3">
        <div className="geo-segmented grid grid-cols-2 p-1">
          <button
            type="button"
            onClick={() => setSubjectType("brand")}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              subjectType === "brand"
                ? "bg-white text-[#0958D9] shadow-sm"
                : "text-slate-500 hover:text-[#1677FF]"
            }`}
          >
            <Building2 className="h-4 w-4" />
            品牌分析
          </button>
          <button
            type="button"
            onClick={() => setSubjectType("person")}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              subjectType === "person"
                ? "bg-white text-[#0958D9] shadow-sm"
                : "text-slate-500 hover:text-[#1677FF]"
            }`}
          >
            <UserRound className="h-4 w-4" />
            个人 IP 分析
          </button>
        </div>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && name.trim()) {
                onCreate(name.trim(), subjectType)
                setName("")
              }
            }}
            placeholder={subjectType === "person"
              ? "输入项目名称（如：王医生个人 IP）"
              : "输入第一个客户名称（如：势途 / 客户A）"}
            className="flex-1 px-4 py-3 text-sm rounded-xl border border-slate-200 bg-white/70 backdrop-blur outline-none focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/20 transition-all"
          />
          <button
            onClick={() => {
              if (name.trim()) {
                onCreate(name.trim(), subjectType)
                setName("")
              }
            }}
            className="rounded-lg bg-gradient-to-r from-[#1677FF] to-[#0958D9] px-5 py-3 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-105"
          >
            创建
          </button>
        </div>
      </div> : null}
    </div>
  )
}

function Dashboard({
  client,
  onChangeClient,
  onExportReport,
  access,
}: {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
  onExportReport: (preset: ReportExportPreset) => void
  access: WorkspaceAccountAccess
}) {
  const [activeModule, setActiveModule] = useState<DashboardModuleKey>(
    access.mode === "client" ? "feedback" : "penetration",
  )
  const subjectType = getClientSubjectType(client)
  const subjectCopy = getSubjectCopy(subjectType)
  const readOnlyModule = access.mode === "client"
    && activeModule !== "penetration"
    && activeModule !== "feedback"
  const moduleOnChange = readOnlyModule ? () => undefined : onChangeClient

  return (
    <div className="geo-page-wrap animate-fade-in-up py-3 md:py-4 print-container">
      <header className="geo-client-banner mb-3 hidden overflow-hidden rounded-lg border border-white/12 shadow-[0_16px_36px_-26px_rgba(0,0,0,0.78)] sm:block">
        <div className="flex min-h-[76px] items-center justify-between gap-4 px-5 py-3">
        <div>
          <div className="mb-1 text-[10px] font-semibold text-cyan-50/65">
            当前客户 · {subjectCopy.modeLabel}
          </div>
          <h1 className="break-words text-2xl font-semibold text-white">
            {client.name}
          </h1>
          {client.industry && (
            <span className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-cyan-50/78">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00C8FF]"></span>
              {client.industry}
            </span>
          )}
          {access.mode === "client" ? (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-[10px] font-semibold text-cyan-50 ring-1 ring-white/15">
              <LockKeyhole className="h-3 w-3" />
              客户专属授权
            </span>
          ) : null}
        </div>
        <div className="text-xs text-white/55">
          创建于 {new Date(client.createdAt).toLocaleDateString("zh-CN")}
        </div>
        </div>
      </header>

      <ModuleNav
        active={activeModule}
        onChange={setActiveModule}
        restricted={access.mode === "client"}
      />

      <section className="mt-3 md:mt-4">
        {readOnlyModule ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-[#91CAFF] bg-[#EAF5FF] px-3 py-2.5 text-xs leading-5 text-[#0958D9] no-print">
            <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            当前为客户专属账号，本模块展示关联主体的现有数据；可使用渗透率情报，并查看已发布的执行反馈。
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
          <KeywordStrategyModule client={client} onChangeClient={moduleOnChange} />
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

type DashboardModuleKey = "penetration" | "research" | "diagnosis" | "difficulty" | "keyword" | "article" | "feedback"

const DASHBOARD_MODULES: Array<{
  key: DashboardModuleKey
  label: string
  desc: string
  icon: typeof Target
  activeClass: string
  iconClass: string
  dotClass: string
}> = [
  {
    key: "penetration",
    label: "渗透率情报",
    desc: "多模型盲测",
    icon: Target,
    activeClass: "bg-gradient-to-r from-[#1677FF] to-[#0958D9] text-white shadow-sm",
    iconClass: "bg-[#E6F4FF] text-[#1677FF]",
    dotClass: "bg-[#00C8FF]",
  },
  {
    key: "research",
    label: "独立调研",
    desc: "品牌画像",
    icon: Brain,
    activeClass: "bg-gradient-to-r from-[#13C2C2] to-[#1677FF] text-white shadow-sm",
    iconClass: "bg-cyan-50 text-[#08979C]",
    dotClass: "bg-[#13C2C2]",
  },
  {
    key: "diagnosis",
    label: "AI 诊断",
    desc: "五维评分",
    icon: Radar,
    activeClass: "bg-gradient-to-r from-[#2F54EB] to-[#597EF7] text-white shadow-sm",
    iconClass: "bg-indigo-50 text-[#2F54EB]",
    dotClass: "bg-[#2F54EB]",
  },
  {
    key: "difficulty",
    label: "难度测评",
    desc: "行业垄断评分",
    icon: Gauge,
    activeClass: "bg-gradient-to-r from-[#0958D9] to-[#003EB3] text-white shadow-sm",
    iconClass: "bg-blue-50 text-[#0958D9]",
    dotClass: "bg-[#0958D9]",
  },
  {
    key: "keyword",
    label: "关键词策略",
    desc: "资料抽取与疑问句池",
    icon: ListOrdered,
    activeClass: "bg-gradient-to-r from-[#4096FF] to-[#00C8FF] text-white shadow-sm",
    iconClass: "bg-sky-50 text-[#1677FF]",
    dotClass: "bg-[#4096FF]",
  },
  {
    key: "article",
    label: "文章生成",
    desc: "Prompt 内容生产",
    icon: FileText,
    activeClass: "bg-gradient-to-r from-[#6C5CE7] to-[#2F54EB] text-white shadow-sm",
    iconClass: "bg-violet-50 text-[#6C5CE7]",
    dotClass: "bg-[#6C5CE7]",
  },
  {
    key: "feedback",
    label: "执行反馈",
    desc: "日历 · 周报月报",
    icon: CalendarRange,
    activeClass: "bg-gradient-to-r from-[#00AEEA] to-[#13C2C2] text-white shadow-sm",
    iconClass: "bg-cyan-50 text-[#08979C]",
    dotClass: "bg-[#13C2C2]",
  },
]

function ModuleNav({
  active,
  onChange,
  restricted = false,
}: {
  active: DashboardModuleKey
  onChange: (key: DashboardModuleKey) => void
  restricted?: boolean
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const current = DASHBOARD_MODULES.find(item => item.key === active) ?? DASHBOARD_MODULES[0]
  const CurrentIcon = current.icon

  return (
    <nav className="no-print">
      <div className="relative md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(open => !open)}
          className="flex h-12 w-full items-center gap-3 rounded-lg border border-[#CFE0F2] bg-white px-3 text-left shadow-[0_10px_28px_-24px_rgba(23,59,102,0.5)]"
          aria-expanded={mobileOpen}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#1677FF] to-[#00AEEA] text-white">
            <CurrentIcon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-[#102A43]">{current.label}</span>
            <span className="block truncate text-[10px] text-[#7E91A7]">{current.desc}</span>
          </span>
          <span className="flex items-center gap-1 text-[11px] font-medium text-[#1677FF]">
            <Grid3X3 className="h-3.5 w-3.5" />
            切换
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${mobileOpen ? "rotate-180" : ""}`} />
          </span>
        </button>
        {mobileOpen ? (
          <div className="absolute inset-x-0 top-14 z-20 grid grid-cols-2 gap-1.5 rounded-lg border border-[#CFE0F2] bg-white p-2 shadow-xl">
            {DASHBOARD_MODULES.map(item => {
              const Icon = item.icon
              const isActive = active === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    onChange(item.key)
                    setMobileOpen(false)
                  }}
                  className={`flex min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left ${
                    isActive ? "bg-[#EAF3FF] text-[#0958D9]" : "text-[#526A83] hover:bg-[#F3F7FB]"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate text-xs font-semibold">{item.label}</span>
                  {restricted && item.key !== "penetration" && item.key !== "feedback" ? (
                    <LockKeyhole className="h-3 w-3 shrink-0 opacity-55" />
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <div className="hidden grid-cols-7 gap-1 rounded-lg border border-[#DCE6F2] bg-white p-1 shadow-[0_12px_30px_-25px_rgba(23,59,102,0.28)] md:grid">
        {DASHBOARD_MODULES.map(item => {
          const Icon = item.icon
          const isActive = active === item.key
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              className={`flex min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                isActive
                  ? "bg-gradient-to-r from-[#0958D9] to-[#1677FF] text-white shadow-sm"
                  : "text-[#526A83] hover:bg-[#F0F6FF] hover:text-[#0958D9]"
              }`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                isActive ? "bg-white/16" : item.iconClass
              }`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-xs font-semibold xl:text-sm">
                  <span className="truncate">{item.label}</span>
                  {restricted && item.key !== "penetration" && item.key !== "feedback" ? (
                    <LockKeyhole className="h-3 w-3 shrink-0 opacity-55" />
                  ) : null}
                </span>
                <span className={`block text-[10px] truncate ${isActive ? "text-white/78" : "text-slate-400"}`}>
                  {item.desc}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
