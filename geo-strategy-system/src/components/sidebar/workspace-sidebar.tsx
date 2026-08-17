"use client"

import Image from "next/image"
import Link from "next/link"
import {
  Brain,
  Building2,
  CalendarRange,
  ChevronRight,
  FileText,
  Gauge,
  GraduationCap,
  LayoutGrid,
  ListOrdered,
  LockKeyhole,
  Radar,
  UserRound,
  X,
} from "lucide-react"
import { getClientSubjectType } from "@/lib/analysis-subject"
import { hasTeamPermission } from "@/lib/team-permissions"
import { cn } from "@/lib/utils"
import type { Client, WorkspaceAccountAccess } from "@/types"

export type DashboardModuleKey =
  | "penetration"
  | "research"
  | "diagnosis"
  | "difficulty"
  | "keyword"
  | "article"
  | "feedback"

export const DASHBOARD_MODULES: ReadonlyArray<{
  key: DashboardModuleKey
  label: string
  desc: string
  icon: typeof Radar
  accent: string
}> = [
  { key: "penetration", label: "渗透率情报", desc: "多模型联网检测", icon: Radar, accent: "from-[#1677FF] to-[#00AEEA]" },
  { key: "research", label: "独立调研", desc: "品牌与竞品调研", icon: Brain, accent: "from-[#13C2C2] to-[#1677FF]" },
  { key: "diagnosis", label: "AI 诊断", desc: "网站 GEO 诊断", icon: LayoutGrid, accent: "from-[#2F54EB] to-[#597EF7]" },
  { key: "difficulty", label: "难度测评", desc: "难度、周期与成本", icon: Gauge, accent: "from-[#0958D9] to-[#1677FF]" },
  { key: "keyword", label: "关键词策略", desc: "问题与发文策略", icon: ListOrdered, accent: "from-[#4096FF] to-[#00C8FF]" },
  { key: "article", label: "文章生成", desc: "多模板内容创作", icon: FileText, accent: "from-[#6C5CE7] to-[#2F54EB]" },
  { key: "feedback", label: "执行反馈", desc: "日历、周报与月报", icon: CalendarRange, accent: "from-[#00AEEA] to-[#13C2C2]" },
] as const

type DashboardWorkflowKey = "insights" | "assessment" | "keyword" | "article" | "feedback"

const DASHBOARD_WORKFLOWS: ReadonlyArray<{
  key: DashboardWorkflowKey
  label: string
  desc: string
  icon: typeof Radar
  accent: string
  modules: ReadonlyArray<{ key: DashboardModuleKey; label: string }>
}> = [
  {
    key: "insights",
    label: "情报洞察",
    desc: "渗透率与联网调研",
    icon: Radar,
    accent: "from-[#1677FF] to-[#00AEEA]",
    modules: [
      { key: "penetration", label: "渗透率检测" },
      { key: "research", label: "联网调研" },
    ],
  },
  {
    key: "assessment",
    label: "诊断评估",
    desc: "网站诊断与难度成本",
    icon: Gauge,
    accent: "from-[#2F54EB] to-[#597EF7]",
    modules: [
      { key: "diagnosis", label: "网站 AI 诊断" },
      { key: "difficulty", label: "难度与成本" },
    ],
  },
  {
    key: "keyword",
    label: "策略规划",
    desc: "问题、信源与发布计划",
    icon: ListOrdered,
    accent: "from-[#4096FF] to-[#00C8FF]",
    modules: [{ key: "keyword", label: "策略规划" }],
  },
  {
    key: "article",
    label: "内容生产",
    desc: "单篇、批量与改写",
    icon: FileText,
    accent: "from-[#6C5CE7] to-[#2F54EB]",
    modules: [{ key: "article", label: "内容生产" }],
  },
  {
    key: "feedback",
    label: "执行复盘",
    desc: "动作、周报与月报",
    icon: CalendarRange,
    accent: "from-[#00AEEA] to-[#13C2C2]",
    modules: [{ key: "feedback", label: "执行复盘" }],
  },
] as const

export function isDashboardModuleKey(value: string | null): value is DashboardModuleKey {
  return DASHBOARD_MODULES.some(module => module.key === value)
}

export default function WorkspaceSidebar({
  active,
  onChange,
  client,
  access,
  open = false,
  onClose,
  monthlyCredits = 0,
  monthlyAllowance = 0,
}: {
  active: DashboardModuleKey
  onChange: (module: DashboardModuleKey) => void
  client: Client | null
  access: WorkspaceAccountAccess
  open?: boolean
  onClose?: () => void
  monthlyCredits?: number
  monthlyAllowance?: number
}) {
  const restricted = access.mode === "client"
  const drawerClass = open ? "translate-x-0" : "-translate-x-full"
  const SubjectIcon = client && getClientSubjectType(client) === "person" ? UserRound : Building2
  const canViewModule = (module: DashboardModuleKey) => {
    if (access.mode === "standard") return true
    if (access.mode === "team") {
      return hasTeamPermission(access.permissionKeys || [], module, "view")
    }
    if (module === "penetration" || module === "feedback") {
      return hasTeamPermission(access.permissionKeys || [], module, "view")
    }
    return true
  }
  const canOperateModule = (module: DashboardModuleKey) => access.mode === "client"
    ? module === "penetration" && access.canRunPenetration
    : access.mode !== "team"
      || (!access.teamReadOnly && (
        hasTeamPermission(access.permissionKeys || [], module, "execute")
        || hasTeamPermission(access.permissionKeys || [], module, "edit")
        || hasTeamPermission(access.permissionKeys || [], module, "manage")
      ))
  const visibleWorkflows = DASHBOARD_WORKFLOWS
    .map(workflow => ({
      ...workflow,
      modules: workflow.modules.filter(module => canViewModule(module.key)),
    }))
    .filter(workflow => workflow.modules.length > 0)

  return (
    <aside className={cn("no-print fixed inset-y-0 left-0 z-50 flex h-screen w-[248px] shrink-0 transform flex-col overflow-hidden bg-[linear-gradient(180deg,#001743_0%,#002C70_52%,#003B8F_100%)] text-white shadow-[10px_0_36px_-28px_rgba(0,29,102,.9)] transition-transform duration-300 ease-out md:static md:translate-x-0", drawerClass)}>
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <Link href="/" className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" title="返回势途 GEO 品牌主页">
          <Image src="/brand/shitu-lockup.jpg" alt="势途" width={840} height={960} sizes="36px" priority className="h-9 w-auto rounded-md bg-white ring-1 ring-white/20" />
          <span className="min-w-0"><span className="block text-sm font-semibold">势途 GEO</span><span className="mt-0.5 block text-[10px] text-white/58">全链路操作工具</span></span>
        </Link>
        {onClose ? <button type="button" onClick={onClose} className="rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white md:hidden" aria-label="关闭功能导航"><X className="h-4 w-4" /></button> : null}
      </div>

      <div className="shrink-0 px-3 pb-3 pt-4">
        <div className="mb-2 px-1 text-[10px] font-semibold text-cyan-100/55">当前客户</div>
        <Link href={access.mode === "team" ? "/account?tab=teams" : "/account?tab=clients"} className="group flex items-center gap-2.5 rounded-lg border border-white/12 bg-white/8 px-3 py-3 transition hover:bg-white/12">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00C8FF] text-white shadow-sm"><SubjectIcon className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-white">{client?.name || access.clientName || "选择客户"}</span><span className="mt-0.5 block truncate text-[10px] text-cyan-50/55">{access.mode === "team" ? access.teamName || "团队共享客户" : client?.industry || (restricted ? "客户专属授权" : "进入我的主页切换")}</span></span>
          <ChevronRight className="h-4 w-4 shrink-0 text-white/35 transition group-hover:translate-x-0.5 group-hover:text-white/70" />
        </Link>
      </div>

      <div className="shrink-0 px-4 pb-2 text-[10px] font-semibold text-cyan-100/55">业务工作流</div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4" aria-label="工作台业务工作流">
        {visibleWorkflows.map(workflow => {
          const Icon = workflow.icon
          const selected = workflow.modules.some(module => module.key === active)
          const defaultModule = workflow.modules[0].key
          const readOnly = workflow.modules.every(module => !canOperateModule(module.key))
          return (
            <div key={workflow.key} className="space-y-1">
              <button
                type="button"
                onClick={() => { onChange(selected ? active : defaultModule); onClose?.() }}
                className={cn("group flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left transition", selected ? `bg-gradient-to-r ${workflow.accent} text-white shadow-sm` : "text-white/68 hover:bg-white/9 hover:text-white")}
                aria-current={selected ? "page" : undefined}
              >
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", selected ? "bg-white/16 text-white" : "bg-white/7 text-cyan-100/70 group-hover:bg-white/12 group-hover:text-white")}><Icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className="truncate text-xs font-semibold">{workflow.label}</span>{readOnly ? <LockKeyhole className="h-3 w-3 shrink-0 opacity-55" /> : null}</span><span className={cn("mt-0.5 block truncate text-[9px]", selected ? "text-white/68" : "text-white/38")}>{workflow.desc}</span></span>
              </button>
              {selected && workflow.modules.length > 1 ? (
                <div className="ml-5 space-y-0.5 border-l border-cyan-100/15 pl-3">
                  {workflow.modules.map(module => {
                    const childSelected = active === module.key
                    const childReadOnly = !canOperateModule(module.key)
                    return (
                      <button
                        key={module.key}
                        type="button"
                        onClick={() => { onChange(module.key); onClose?.() }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[10px] font-semibold transition",
                          childSelected
                            ? "bg-white/12 text-white"
                            : "text-white/52 hover:bg-white/8 hover:text-white/85",
                        )}
                        aria-current={childSelected ? "page" : undefined}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", childSelected ? "bg-cyan-200" : "bg-white/25")} />
                        <span className="min-w-0 flex-1 truncate">{module.label}</span>
                        {childReadOnly ? <LockKeyhole className="h-3 w-3 shrink-0 opacity-50" /> : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
      </nav>

      <div className="shrink-0 border-t border-white/10 px-3 py-3">
        {restricted ? (
          <div className="mb-3 rounded-lg bg-white/7 px-3 py-2.5 ring-1 ring-white/10">
            <div className="flex items-center justify-between text-[10px] text-white/58"><span>本月专属额度</span><span className="font-mono font-semibold text-cyan-100">{monthlyCredits}/{monthlyAllowance || 0}</span></div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-[#00C8FF] to-[#69E3E0]" style={{ width: `${monthlyAllowance > 0 ? Math.min(100, Math.max(0, monthlyCredits / monthlyAllowance * 100)) : 0}%` }} /></div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-1">
          <Link href="/account" className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-white/7 text-[10px] font-semibold text-white/72 transition hover:bg-white/12 hover:text-white"><UserRound className="h-3.5 w-3.5" />我的主页</Link>
          <Link href="/workspace/tutorial?manual=1" className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-white/7 text-[10px] font-semibold text-white/72 transition hover:bg-white/12 hover:text-white"><GraduationCap className="h-3.5 w-3.5" />新手教程</Link>
        </div>
      </div>
    </aside>
  )
}
