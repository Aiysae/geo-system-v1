"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  Bot,
  CheckCircle2,
  CircleHelp,
  Cloud,
  CloudOff,
  FileDown,
  GraduationCap,
  History,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
} from "lucide-react"
import { useCredits } from "@/components/credits/credits-provider"
import { RechargeButton } from "@/components/credits/recharge-button"
import { AccountMenu } from "@/components/auth/account-menu"
import type { WorkspaceSyncState } from "@/hooks/use-workspace-sync"
import type { WorkspaceAccountAccess } from "@/types"

// The dark top bar shared by the GEO workspace and the publishing console.
// Report and sync controls appear only when their handlers are passed.
export function WorkspaceHeader({
  title,
  subtitle,
  helpHref,
  onOpenSidebar,
  onExportReport,
  onOpenReportHistory,
  syncState,
  onRetrySync,
  access,
  adminNotifier,
  taskNotifier,
  userNotifier,
}: {
  title: string
  subtitle: string
  helpHref: string
  onOpenSidebar: () => void
  onExportReport?: () => void
  onOpenReportHistory?: () => void
  syncState?: WorkspaceSyncState
  onRetrySync?: () => void
  access: WorkspaceAccountAccess
  adminNotifier?: React.ReactNode
  taskNotifier?: React.ReactNode
  userNotifier?: React.ReactNode
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
            aria-label="打开功能导航"
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
              {title}
            </div>
            <div className="hidden truncate text-[10px] text-white/58 sm:block">
              {subtitle}
            </div>
          </div>
        </div>

        <div className={`no-print hidden items-center gap-2 ${access.mode === "client" ? "" : "lg:flex"}`}>
          <Link
            href="/agent"
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#69DFFF]/55 bg-[#00AEEA]/18 px-3 text-xs font-bold text-cyan-50 shadow-[0_10px_24px_-18px_rgba(0,200,255,0.9)] transition hover:bg-[#00AEEA]/28"
            title="查看 Agent 接入方式"
          >
            <Bot className="h-3.5 w-3.5" />
            Agent 接入
          </Link>
          <Link
            href={helpHref}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/20 bg-white/8 text-white transition hover:bg-white/14"
            title="查看当前模块使用说明"
            aria-label="查看当前模块使用说明"
          >
            <CircleHelp className="h-4 w-4" />
          </Link>
          <Link
            href="/workspace/tutorial?manual=1"
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/20 bg-white/8 px-3 text-xs font-semibold text-white transition hover:bg-white/14"
            title="重新体验新手教程"
          >
            <GraduationCap className="h-3.5 w-3.5" />
            新手教程
          </Link>
          {onOpenReportHistory ? (
            <button
              type="button"
              onClick={onOpenReportHistory}
              className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/20 bg-white/8 px-3 text-xs font-semibold text-white transition hover:bg-white/14"
              title="查看历史成果"
            >
              <History className="h-3.5 w-3.5" />
              历史成果
            </button>
          ) : null}
          {onExportReport && (
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
          {syncState && onRetrySync ? (
            <div className="hidden xl:block">
              <WorkspaceSyncIndicator state={syncState} onRetry={onRetrySync} />
            </div>
          ) : null}
          <CreditsPill />
          <RechargeButton />
          {userNotifier}
          {adminNotifier}
          {taskNotifier}
          <div className={`relative ${access.mode === "client" ? "" : "lg:hidden"}`}>
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
                  <Link
                    href="/agent"
                    onClick={() => setMobileActionsOpen(false)}
                    className="flex h-10 w-full items-center gap-2 rounded-md bg-[#EAF4FF] px-3 text-left text-xs font-bold text-[#0958D9] hover:bg-[#DCEEFF]"
                  >
                    <Bot className="h-4 w-4 text-[#1677FF]" />
                    Agent 接入
                  </Link>
                  <Link
                    href={helpHref}
                    onClick={() => setMobileActionsOpen(false)}
                    className="flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-xs font-semibold hover:bg-[#EEF5FC]"
                  >
                    <CircleHelp className="h-4 w-4 text-[#1677FF]" />
                    当前模块说明
                  </Link>
                  <Link
                    href="/workspace/tutorial?manual=1"
                    onClick={() => setMobileActionsOpen(false)}
                    className="flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-xs font-semibold hover:bg-[#EEF5FC]"
                  >
                    <GraduationCap className="h-4 w-4 text-[#00AEEA]" />
                    新手体验教程
                  </Link>
                  {onOpenReportHistory ? (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenReportHistory()
                        setMobileActionsOpen(false)
                      }}
                      className="flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-xs font-semibold hover:bg-[#EEF5FC]"
                    >
                      <History className="h-4 w-4 text-[#1677FF]" />
                      历史成果
                    </button>
                  ) : null}
                  {onExportReport ? (
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
                  {syncState?.phase === "error" && onRetrySync ? (
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

export function CreditsPill() {
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
