"use client"

import Link from "next/link"
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react"
import {
  Activity,
  Archive,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  Crown,
  Loader2,
  LockKeyhole,
  MailPlus,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRoundCog,
  UsersRound,
  X,
} from "lucide-react"
import {
  TEAM_MODULES,
  TEAM_PERMISSION_GROUPS,
  TEAM_PERMISSION_PRESETS,
  hasTeamPermission,
  normalizeTeamPermissions,
  permissionsForPreset,
  teamPermissionLabel,
  teamRoleLabel,
  type TeamMemberStatus,
  type TeamPermissionAction,
  type TeamPermissionKey,
  type TeamPermissionPresetKey,
  type TeamRole,
} from "@/lib/team-permissions"
import { cn } from "@/lib/utils"
import type { MembershipSnapshot } from "@/types"
import type {
  TeamAuditRecord,
  TeamClientShareRecord,
  TeamInviteView,
  TeamMemberView,
  TeamSummary,
} from "@/types/team"

type TeamEntitlement = {
  eligible: boolean
  memberLimit: number
  tier: string
  reason?: string
}

type TeamIndexPayload = {
  teams: TeamSummary[]
  entitlement: TeamEntitlement
  isClientAccount: boolean
  canCreate: boolean
}

type OwnClient = {
  id: string
  name: string
  ourBrand: string
  subjectType: "brand" | "person"
  industry: string
}

type TeamShareView = TeamClientShareRecord & { ownerName?: string }

type TeamDetailPayload = {
  team: TeamSummary["team"]
  membership: TeamSummary["membership"]
  members: TeamMemberView[]
  shares: TeamShareView[]
  invites: TeamInviteView[]
  audit: TeamAuditRecord[]
  entitlement: TeamEntitlement
  canManageTeam: boolean
  canArchiveTeam: boolean
  ownClients: OwnClient[]
}

type Notice = { tone: "success" | "error" | "info"; text: string }

const ACTION_ORDER: TeamPermissionAction[] = ["view", "execute", "edit", "export", "manage"]

const AUDIT_LABELS: Record<string, string> = {
  team_created: "创建团队",
  team_updated: "更新团队资料",
  team_archived: "归档团队",
  member_invited: "邀请成员",
  member_joined: "成员加入",
  member_updated: "更新成员权限",
  member_suspended: "暂停成员",
  member_removed: "移除成员",
  client_shared: "开放客户档案",
  client_share_updated: "更新客户共享范围",
  client_unshared: "取消客户共享",
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error || "请求失败")
  return payload as T
}

function formatTime(value: string): string {
  if (!value) return "-"
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function roleBadge(role: TeamRole) {
  if (role === "owner") return "border-amber-200 bg-amber-50 text-amber-700"
  if (role === "admin") return "border-blue-200 bg-blue-50 text-blue-700"
  return "border-slate-200 bg-slate-50 text-slate-600"
}

export function TeamCenter({
  membership,
  isAdmin,
  isClientAccount,
}: {
  membership: MembershipSnapshot
  isAdmin: boolean
  isClientAccount: boolean
}) {
  const [index, setIndex] = useState<TeamIndexPayload | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState("")
  const [detail, setDetail] = useState<TeamDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [teamName, setTeamName] = useState("")
  const [notice, setNotice] = useState<Notice | null>(null)
  const [memberEditor, setMemberEditor] = useState<TeamMemberView | null>(null)

  const loadIndex = useCallback(async (preferredTeamId?: string) => {
    setLoading(true)
    try {
      const payload = await readJson<TeamIndexPayload>(
        await fetch("/api/teams", { cache: "no-store" }),
      )
      setIndex(payload)
      setSelectedTeamId(current => {
        const requested = preferredTeamId || current
        if (requested && payload.teams.some(summary => summary.team.id === requested)) return requested
        return payload.teams[0]?.team.id || ""
      })
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "团队列表读取失败" })
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDetail = useCallback(async (teamId: string) => {
    if (!teamId) {
      setDetail(null)
      return
    }
    setDetailLoading(true)
    try {
      const payload = await readJson<TeamDetailPayload>(
        await fetch(`/api/teams/${encodeURIComponent(teamId)}`, { cache: "no-store" }),
      )
      setDetail(payload)
    } catch (error) {
      setDetail(null)
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "团队详情读取失败" })
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadIndex(), 0)
    return () => window.clearTimeout(timer)
  }, [loadIndex])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDetail(selectedTeamId), 0)
    return () => window.clearTimeout(timer)
  }, [loadDetail, selectedTeamId])

  async function createTeam(event: FormEvent) {
    event.preventDefault()
    setCreating(true)
    setNotice(null)
    try {
      const payload = await readJson<{ team: TeamSummary["team"] }>(
        await fetch("/api/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: teamName }),
        }),
      )
      setTeamName("")
      setNotice({ tone: "success", text: "团队已创建，可以开始邀请成员和开放客户档案。" })
      await loadIndex(payload.team.id)
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "团队创建失败" })
    } finally {
      setCreating(false)
    }
  }

  async function archiveTeam() {
    if (!detail || !window.confirm("归档后团队成员将无法继续进入共享客户。确认归档吗？")) return
    try {
      await readJson(await fetch(`/api/teams/${encodeURIComponent(detail.team.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      }))
      setNotice({ tone: "success", text: "团队已归档。" })
      setDetail(null)
      setSelectedTeamId("")
      await loadIndex()
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "团队归档失败" })
    }
  }

  if (loading && !index) {
    return <LoadingPanel text="正在读取团队空间" />
  }

  if (isClientAccount || index?.isClientAccount || isClientAccount) {
    return (
      <LockedPanel
        icon={LockKeyhole}
        title="客户专属账号不参与内部团队"
        detail="该账号已经绑定单一客户面板。需要参与内部协作时，请使用独立注册账号接受团队邀请。"
      />
    )
  }

  const entitlement = index?.entitlement
  const hasTeams = Boolean(index?.teams.length)
  if (!hasTeams && !entitlement?.eligible && !isAdmin) {
    return (
      <LockedPanel
        icon={Crown}
        title="VIP4 解锁团队协作"
        detail={`当前为 ${membership.tier === "free" ? "普通用户" : membership.tier.toUpperCase()}。累计实际充值达到 1500 元后，可创建团队、共享客户档案并按模块分配权限。`}
      >
        <Link href="/billing" className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-sm font-semibold text-white">
          查看升级方案
          <ArrowRight className="h-4 w-4" />
        </Link>
      </LockedPanel>
    )
  }

  return (
    <div className="space-y-4">
      {notice ? <NoticeBar notice={notice} onClose={() => setNotice(null)} /> : null}

      <section className="overflow-hidden rounded-lg border border-[#CFE4FA] bg-white shadow-sm">
        <div className="flex flex-col gap-4 bg-[linear-gradient(115deg,#001D66_0%,#0958D9_56%,#00AEEA_100%)] px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-100">
              <UsersRound className="h-4 w-4" />
              团队协作空间
            </div>
            <h2 className="mt-2 text-xl font-bold">客户共享与模块级权限</h2>
            <p className="mt-1 text-xs leading-5 text-cyan-50/75">每位成员只看到被开放的客户，并只能执行被授予的模块操作。</p>
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-white/20 ring-1 ring-white/25">
            <Metric label="团队数量" value={String(index?.teams.length || 0)} />
            <Metric label="成员名额" value={entitlement?.eligible ? String(entitlement.memberLimit) : "只读"} />
          </div>
        </div>

        {hasTeams ? (
          <div className="flex gap-2 overflow-x-auto border-b border-[#E2EDF8] bg-[#F8FBFF] px-4 py-3">
            {index?.teams.map(summary => (
              <button
                key={summary.team.id}
                type="button"
                onClick={() => setSelectedTeamId(summary.team.id)}
                className={cn(
                  "flex min-w-[220px] items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                  selectedTeamId === summary.team.id
                    ? "border-[#69B1FF] bg-white text-[#0958D9] shadow-sm"
                    : "border-transparent bg-transparent text-slate-600 hover:border-[#D1E9FF] hover:bg-white",
                )}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{summary.team.name}</div>
                  <div className="mt-1 text-[10px] text-slate-400">{summary.memberCount} 人 · {summary.sharedClientCount} 个共享客户</div>
                </div>
                <span className={cn("shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold", roleBadge(summary.membership.role))}>{teamRoleLabel(summary.membership.role)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {!hasTeams && index?.canCreate ? (
        <section className="rounded-lg border border-[#CFE4FA] bg-white p-5 shadow-sm">
          <div className="max-w-xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#EAF4FF] text-[#1677FF]"><Plus className="h-5 w-5" /></div>
            <h3 className="mt-4 text-lg font-bold text-slate-950">创建第一个团队</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">团队名称可使用公司名或业务部门名，创建后由您统一承担团队任务积分。</p>
            <form onSubmit={createTeam} className="mt-5 flex flex-col gap-3 sm:flex-row">
              <input
                value={teamName}
                onChange={event => setTeamName(event.target.value)}
                placeholder="例如：势途 GEO 运营团队"
                maxLength={80}
                className="h-11 flex-1 rounded-lg border border-[#C9DDF2] bg-white px-3.5 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-blue-100"
              />
              <button type="submit" disabled={creating} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#1677FF] px-5 text-sm font-semibold text-white disabled:opacity-60">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                创建团队
              </button>
            </form>
          </div>
        </section>
      ) : null}

      {detailLoading ? <LoadingPanel text="正在同步团队成员与客户权限" /> : null}

      {detail && !detailLoading ? (
        <>
          {!detail.entitlement.eligible ? (
            <NoticeBar notice={{ tone: "info", text: "团队所有者当前未达到 VIP4，历史数据仍可查看，执行和编辑功能暂时只读。" }} />
          ) : null}
          <section className="rounded-lg border border-[#D8E7F7] bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-bold text-slate-950">{detail.team.name}</h3>
                  <span className={cn("rounded-md border px-2 py-1 text-[10px] font-semibold", roleBadge(detail.membership.role))}>{teamRoleLabel(detail.membership.role)}</span>
                  {detail.entitlement.eligible ? <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">协作正常</span> : <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">只读</span>}
                </div>
                <p className="mt-1 text-xs text-slate-500">团队积分由所有者账户统一结算，操作记录保留成员身份。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => loadDetail(detail.team.id)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#C9DDF2] bg-white px-3 text-xs font-semibold text-slate-600 hover:border-[#69B1FF] hover:text-[#0958D9]">
                  <RefreshCw className="h-3.5 w-3.5" />
                  刷新
                </button>
                {detail.canArchiveTeam ? (
                  <button type="button" onClick={archiveTeam} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-600 hover:bg-rose-100">
                    <Archive className="h-3.5 w-3.5" />
                    归档团队
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          <div className="grid gap-4 2xl:grid-cols-[1.08fr_.92fr]">
            <MemberSection
              detail={detail}
              onEdit={setMemberEditor}
              onRefresh={() => loadDetail(detail.team.id)}
              onNotice={setNotice}
            />
            <InviteSection
              detail={detail}
              onRefresh={() => loadDetail(detail.team.id)}
              onNotice={setNotice}
            />
          </div>

          <ClientShareSection
            detail={detail}
            onRefresh={() => loadDetail(detail.team.id)}
            onNotice={setNotice}
          />

          {detail.canManageTeam ? <AuditSection audit={detail.audit} members={detail.members} /> : null}
        </>
      ) : null}

      {memberEditor && detail ? (
        <MemberPermissionDialog
          teamId={detail.team.id}
          member={memberEditor}
          actorRole={detail.membership.role}
          onClose={() => setMemberEditor(null)}
          onSaved={async message => {
            setMemberEditor(null)
            setNotice({ tone: "success", text: message })
            await loadDetail(detail.team.id)
          }}
          onError={message => setNotice({ tone: "error", text: message })}
        />
      ) : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[110px] bg-[#001D66]/30 px-4 py-3 backdrop-blur-sm">
      <div className="text-[10px] text-cyan-50/70">{label}</div>
      <div className="mt-1 font-mono text-lg font-bold">{value}</div>
    </div>
  )
}

function LoadingPanel({ text }: { text: string }) {
  return (
    <div className="flex min-h-44 items-center justify-center rounded-lg border border-[#D8E7F7] bg-white text-sm text-slate-500 shadow-sm">
      <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#1677FF]" />
      {text}
    </div>
  )
}

function LockedPanel({
  icon: Icon,
  title,
  detail,
  children,
}: {
  icon: typeof LockKeyhole
  title: string
  detail: string
  children?: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-[#D8E7F7] bg-white p-6 shadow-sm sm:p-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#EAF4FF] text-[#1677FF]"><Icon className="h-6 w-6" /></div>
      <h2 className="mt-5 text-xl font-bold text-slate-950">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500">{detail}</p>
      {children}
    </section>
  )
}

function NoticeBar({ notice, onClose }: { notice: Notice; onClose?: () => void }) {
  const styles = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    error: "border-rose-200 bg-rose-50 text-rose-700",
    info: "border-blue-200 bg-blue-50 text-blue-700",
  }[notice.tone]
  return (
    <div className={cn("flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm", styles)}>
      <div className="flex items-start gap-2">
        {notice.tone === "success" ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>{notice.text}</span>
      </div>
      {onClose ? <button type="button" onClick={onClose} className="shrink-0 opacity-70 hover:opacity-100" aria-label="关闭提示"><X className="h-4 w-4" /></button> : null}
    </div>
  )
}

function SectionTitle({
  icon: Icon,
  title,
  detail,
  action,
}: {
  icon: typeof UsersRound
  title: string
  detail: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EAF4FF] text-[#1677FF]"><Icon className="h-4 w-4" /></span>
        <div>
          <h3 className="text-sm font-bold text-slate-950">{title}</h3>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">{detail}</p>
        </div>
      </div>
      {action}
    </div>
  )
}

function MemberSection({
  detail,
  onEdit,
  onRefresh,
  onNotice,
}: {
  detail: TeamDetailPayload
  onEdit: (member: TeamMemberView) => void
  onRefresh: () => Promise<void>
  onNotice: (notice: Notice) => void
}) {
  async function remove(member: TeamMemberView) {
    if (!window.confirm(`确认将“${member.name || member.email}”移出团队吗？`)) return
    try {
      await readJson(await fetch(
        `/api/teams/${encodeURIComponent(detail.team.id)}/members/${encodeURIComponent(member.userId)}`,
        { method: "DELETE" },
      ))
      onNotice({ tone: "success", text: "成员已移出团队，相关客户和任务权限立即失效。" })
      await onRefresh()
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : "成员移除失败" })
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm">
      <SectionTitle
        icon={UserRoundCog}
        title="团队成员"
        detail={`已使用 ${detail.members.filter(member => member.status === "active" && member.role !== "owner").length}/${detail.entitlement.memberLimit} 个成员名额`}
      />
      <div className="divide-y divide-slate-100">
        {detail.members.map(member => {
          const canEdit = detail.canManageTeam
            && member.role !== "owner"
            && !(detail.membership.role === "admin" && member.role === "admin")
          const moduleCount = TEAM_MODULES.filter(module => hasTeamPermission(
            member.permissionKeys,
            module.key,
            "view",
          )).length
          return (
            <div key={member.userId} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold", member.status === "active" ? "bg-[#EAF4FF] text-[#0958D9]" : "bg-slate-100 text-slate-400")}>{(member.name || member.email).slice(0, 2).toUpperCase()}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-bold text-slate-900">{member.name || member.email}</span>
                    <span className={cn("rounded-md border px-1.5 py-0.5 text-[9px] font-semibold", roleBadge(member.role))}>{teamRoleLabel(member.role)}</span>
                    {member.status === "suspended" ? <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">已暂停</span> : null}
                  </div>
                  <div className="mt-1 truncate text-[11px] text-slate-400">{member.email} · {member.role === "owner" ? "全部权限" : `${moduleCount} 个模块`}</div>
                </div>
              </div>
              {canEdit ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => onEdit(member)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#C9DDF2] bg-white px-2.5 text-[11px] font-semibold text-[#0958D9] hover:border-[#69B1FF]">
                    <Settings2 className="h-3.5 w-3.5" />
                    权限
                  </button>
                  <button type="button" onClick={() => remove(member)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-500 hover:bg-rose-100" aria-label="移除成员">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function InviteSection({
  detail,
  onRefresh,
  onNotice,
}: {
  detail: TeamDetailPayload
  onRefresh: () => Promise<void>
  onNotice: (notice: Notice) => void
}) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"admin" | "member">("member")
  const [preset, setPreset] = useState<TeamPermissionPresetKey>("viewer")
  const [submitting, setSubmitting] = useState(false)
  const [latestInviteUrl, setLatestInviteUrl] = useState("")

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setLatestInviteUrl("")
    try {
      const payload = await readJson<{
        inviteUrl: string
        emailSent: boolean
        emailWarning?: string
      }>(await fetch(`/api/teams/${encodeURIComponent(detail.team.id)}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role, preset }),
      }))
      setLatestInviteUrl(payload.inviteUrl)
      setEmail("")
      onNotice({
        tone: payload.emailSent ? "success" : "info",
        text: payload.emailSent
          ? "团队邀请已发送。"
          : `邀请已创建，但邮件暂未送达：${payload.emailWarning || "请复制邀请链接发送给成员"}`,
      })
      await onRefresh()
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : "邀请创建失败" })
    } finally {
      setSubmitting(false)
    }
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(latestInviteUrl)
    onNotice({ tone: "success", text: "邀请链接已复制。" })
  }

  if (!detail.canManageTeam) {
    return (
      <section className="overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm">
        <SectionTitle icon={MailPlus} title="成员邀请" detail="只有团队所有者或管理员可以邀请成员。" />
        <div className="p-5 text-sm text-slate-500">您可以在共享客户中使用已获授权的模块，无需管理其他成员。</div>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm">
      <SectionTitle icon={MailPlus} title="邀请成员" detail="成员使用自己的账号登录，邀请链接 7 天内有效。" />
      <form onSubmit={submit} className="grid gap-3 p-4 sm:p-5">
        <label className="grid gap-1.5 text-[11px] font-semibold text-slate-600">
          成员邮箱
          <input value={email} onChange={event => setEmail(event.target.value)} required type="email" placeholder="member@example.com" className="h-10 rounded-lg border border-[#C9DDF2] px-3 text-sm font-normal outline-none focus:border-[#1677FF] focus:ring-2 focus:ring-blue-100" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-[11px] font-semibold text-slate-600">
            角色
            <select value={role} onChange={event => setRole(event.target.value === "admin" ? "admin" : "member")} disabled={detail.membership.role !== "owner"} className="h-10 rounded-lg border border-[#C9DDF2] bg-white px-3 text-sm font-normal outline-none focus:border-[#1677FF]">
              <option value="member">普通成员</option>
              {detail.membership.role === "owner" ? <option value="admin">团队管理员</option> : null}
            </select>
          </label>
          <label className="grid gap-1.5 text-[11px] font-semibold text-slate-600">
            权限模板
            <select value={preset} onChange={event => setPreset(event.target.value as TeamPermissionPresetKey)} className="h-10 rounded-lg border border-[#C9DDF2] bg-white px-3 text-sm font-normal outline-none focus:border-[#1677FF]">
              {TEAM_PERMISSION_PRESETS.filter(item => item.key !== "custom").map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
        </div>
        <button type="submit" disabled={submitting || !detail.entitlement.eligible} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />}
          发送邀请
        </button>
        {latestInviteUrl ? (
          <button type="button" onClick={copyInvite} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#B7DBFF] bg-[#F0F7FF] text-xs font-semibold text-[#0958D9]">
            <Clipboard className="h-3.5 w-3.5" />
            复制备用邀请链接
          </button>
        ) : null}
      </form>
      {detail.invites.length > 0 ? (
        <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
          <div className="mb-2 text-[10px] font-bold text-slate-400">最近邀请</div>
          <div className="space-y-2">
            {detail.invites.slice(0, 5).map(invite => (
              <div key={invite.id} className="flex items-center justify-between gap-3 text-[11px]">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-slate-700">{invite.email}</div>
                  <div className="mt-0.5 text-slate-400">{teamRoleLabel(invite.role)} · {formatTime(invite.createdAt)}</div>
                </div>
                <span className={cn("shrink-0 rounded-md px-2 py-1 font-semibold", invite.status === "pending" ? "bg-amber-50 text-amber-600" : invite.status === "accepted" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500")}>{invite.status === "pending" ? "待接受" : invite.status === "accepted" ? "已加入" : invite.status === "expired" ? "已过期" : "已撤销"}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ClientShareSection({
  detail,
  onRefresh,
  onNotice,
}: {
  detail: TeamDetailPayload
  onRefresh: () => Promise<void>
  onNotice: (notice: Notice) => void
}) {
  const ownShares = detail.shares.filter(share => share.clientOwnerUserId === detail.membership.userId)
  const receivedShares = detail.shares.filter(share => share.clientOwnerUserId !== detail.membership.userId)
  const canShare = detail.membership.role === "owner"
    || hasTeamPermission(detail.membership.permissionKeys, "client", "manage")

  async function toggleClient(client: OwnClient) {
    const existing = ownShares.find(share => share.clientId === client.id)
    try {
      if (existing) {
        await readJson(await fetch(`/api/teams/${encodeURIComponent(detail.team.id)}/shares/${encodeURIComponent(client.id)}`, { method: "DELETE" }))
        onNotice({ tone: "success", text: `已停止共享“${client.name}”。` })
      } else {
        await readJson(await fetch(`/api/teams/${encodeURIComponent(detail.team.id)}/shares`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: client.id, scope: "all" }),
        }))
        onNotice({ tone: "success", text: `“${client.name}”已开放给团队成员。` })
      }
      await onRefresh()
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : "客户共享更新失败" })
    }
  }

  async function updateScope(share: TeamShareView, scope: "all" | "selected", memberUserIds: string[]) {
    try {
      await readJson(await fetch(`/api/teams/${encodeURIComponent(detail.team.id)}/shares/${encodeURIComponent(share.clientId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, memberUserIds }),
      }))
      onNotice({ tone: "success", text: "客户共享范围已更新。" })
      await onRefresh()
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : "共享范围更新失败" })
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm">
      <SectionTitle
        icon={BriefcaseBusiness}
        title="共享客户档案"
        detail="客户资料归原账号所有；开放后，成员仍受各自模块权限约束。"
      />
      <div className="grid gap-px bg-[#E2EDF8] lg:grid-cols-2">
        <div className="bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800">我拥有的客户</h4>
            <span className="text-[10px] text-slate-400">{detail.ownClients.length} 个</span>
          </div>
          {!canShare ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-700">团队所有者尚未授予“客户资料管理”权限。</p> : null}
          <div className="mt-3 space-y-2">
            {detail.ownClients.length > 0 ? detail.ownClients.map(client => {
              const share = ownShares.find(item => item.clientId === client.id)
              return (
                <div key={client.id} className="rounded-lg border border-[#E2EDF8] bg-[#FAFCFF] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-slate-800">{client.name}</div>
                      <div className="mt-1 truncate text-[10px] text-slate-400">{client.ourBrand || client.industry || "客户档案"}</div>
                    </div>
                    <button
                      type="button"
                      disabled={!canShare || !detail.entitlement.eligible}
                      onClick={() => toggleClient(client)}
                      className={cn(
                        "relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40",
                        share ? "bg-[#1677FF]" : "bg-slate-200",
                      )}
                      aria-label={share ? "停止共享" : "开放共享"}
                    >
                      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", share ? "left-[22px]" : "left-0.5")} />
                    </button>
                  </div>
                  {share ? (
                    <ShareScopeEditor
                      share={share}
                      members={detail.members.filter(member => member.status === "active" && member.userId !== detail.membership.userId)}
                      onSave={updateScope}
                    />
                  ) : null}
                </div>
              )
            }) : <p className="py-8 text-center text-xs text-slate-400">当前账号还没有客户档案</p>}
          </div>
        </div>
        <div className="bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800">团队向我开放</h4>
            <span className="text-[10px] text-slate-400">{receivedShares.length} 个</span>
          </div>
          <div className="mt-3 space-y-2">
            {receivedShares.length > 0 ? receivedShares.map(share => (
              <Link
                key={`${share.clientOwnerUserId}:${share.clientId}`}
                href={`/workspace?teamId=${encodeURIComponent(detail.team.id)}&clientId=${encodeURIComponent(share.clientId)}&module=penetration`}
                className="group flex items-center justify-between gap-3 rounded-lg border border-[#E2EDF8] bg-[#FAFCFF] p-3 transition hover:border-[#69B1FF] hover:bg-[#F0F7FF]"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-slate-800">{share.clientName}</div>
                  <div className="mt-1 truncate text-[10px] text-slate-400">{share.ownerName || "团队成员"} 开放 · {share.scope === "all" ? "全员可见" : "定向开放"}</div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-[#1677FF] transition group-hover:translate-x-0.5" />
              </Link>
            )) : <p className="py-8 text-center text-xs text-slate-400">暂无其他成员向您开放的客户</p>}
          </div>
        </div>
      </div>
    </section>
  )
}

function ShareScopeEditor({
  share,
  members,
  onSave,
}: {
  share: TeamShareView
  members: TeamMemberView[]
  onSave: (share: TeamShareView, scope: "all" | "selected", memberUserIds: string[]) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<"all" | "selected">(share.scope)
  const [selected, setSelected] = useState<string[]>(share.memberUserIds)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    await onSave(share, scope, selected)
    setSaving(false)
    setOpen(false)
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-2.5">
      <button type="button" onClick={() => setOpen(value => !value)} className="flex w-full items-center justify-between text-[10px] font-semibold text-[#0958D9]">
        {share.scope === "all" ? "全体成员可见" : `${share.memberUserIds.length} 名成员可见`}
        <ChevronDown className={cn("h-3.5 w-3.5 transition", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="mt-3 rounded-lg border border-[#D8E7F7] bg-white p-3">
          <div className="grid grid-cols-2 gap-2">
            {(["all", "selected"] as const).map(value => (
              <button key={value} type="button" onClick={() => setScope(value)} className={cn("h-8 rounded-lg border text-[10px] font-semibold", scope === value ? "border-[#69B1FF] bg-[#EAF4FF] text-[#0958D9]" : "border-slate-200 text-slate-500")}>{value === "all" ? "全体成员" : "指定成员"}</button>
            ))}
          </div>
          {scope === "selected" ? (
            <div className="mt-3 max-h-36 space-y-1.5 overflow-y-auto">
              {members.map(member => (
                <label key={member.userId} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[11px] hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={selected.includes(member.userId)}
                    onChange={event => setSelected(current => event.target.checked ? [...current, member.userId] : current.filter(userId => userId !== member.userId))}
                    className="h-3.5 w-3.5 accent-[#1677FF]"
                  />
                  <span className="truncate">{member.name || member.email}</span>
                </label>
              ))}
            </div>
          ) : null}
          <button type="button" onClick={save} disabled={saving || (scope === "selected" && selected.length === 0)} className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-[#1677FF] text-[11px] font-semibold text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            保存范围
          </button>
        </div>
      ) : null}
    </div>
  )
}

function MemberPermissionDialog({
  teamId,
  member,
  actorRole,
  onClose,
  onSaved,
  onError,
}: {
  teamId: string
  member: TeamMemberView
  actorRole: TeamRole
  onClose: () => void
  onSaved: (message: string) => Promise<void>
  onError: (message: string) => void
}) {
  const [role, setRole] = useState<Exclude<TeamRole, "owner">>(member.role === "admin" ? "admin" : "member")
  const [status, setStatus] = useState<TeamMemberStatus>(member.status)
  const [permissions, setPermissions] = useState<TeamPermissionKey[]>(member.permissionKeys)
  const [preset, setPreset] = useState<TeamPermissionPresetKey>("custom")
  const [saving, setSaving] = useState(false)

  function applyPreset(key: TeamPermissionPresetKey) {
    setPreset(key)
    if (key !== "custom") setPermissions(permissionsForPreset(key))
  }

  function toggle(moduleKey: (typeof TEAM_MODULES)[number]["key"], action: TeamPermissionAction) {
    const permission = `${moduleKey}.${action}` as TeamPermissionKey
    setPreset("custom")
    setPermissions(current => {
      if (current.includes(permission)) {
        const next = action === "view"
          ? current.filter(item => !item.startsWith(`${moduleKey}.`))
          : current.filter(item => item !== permission)
        return normalizeTeamPermissions(next)
      }
      return normalizeTeamPermissions([...current, permission])
    })
  }

  async function save() {
    setSaving(true)
    try {
      await readJson(await fetch(
        `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(member.userId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, status, permissionKeys: permissions }),
        },
      ))
      await onSaved("成员角色与模块权限已生效。")
    } catch (error) {
      onError(error instanceof Error ? error.message : "权限保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-[#001D66]/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="配置团队成员权限">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-xl border border-white/30 bg-white shadow-2xl sm:rounded-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#E2EDF8] px-4 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[#1677FF]"><ShieldCheck className="h-4 w-4" />成员权限</div>
            <h3 className="mt-1 text-lg font-bold text-slate-950">{member.name || member.email}</h3>
            <p className="mt-1 text-[11px] text-slate-500">未授权的入口会隐藏，服务端也会拒绝直接调用。</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="关闭"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto p-4 sm:p-6">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1.5 text-[11px] font-semibold text-slate-600">
              角色
              <select value={role} onChange={event => setRole(event.target.value === "admin" ? "admin" : "member")} disabled={actorRole !== "owner"} className="h-10 rounded-lg border border-[#C9DDF2] bg-white px-3 text-sm font-normal">
                <option value="member">普通成员</option>
                {actorRole === "owner" ? <option value="admin">团队管理员</option> : null}
              </select>
            </label>
            <label className="grid gap-1.5 text-[11px] font-semibold text-slate-600">
              账号状态
              <select value={status} onChange={event => setStatus(event.target.value === "suspended" ? "suspended" : "active")} className="h-10 rounded-lg border border-[#C9DDF2] bg-white px-3 text-sm font-normal">
                <option value="active">正常协作</option>
                <option value="suspended">暂停访问</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-[11px] font-semibold text-slate-600">
              快捷模板
              <select value={preset} onChange={event => applyPreset(event.target.value as TeamPermissionPresetKey)} className="h-10 rounded-lg border border-[#C9DDF2] bg-white px-3 text-sm font-normal">
                {TEAM_PERMISSION_PRESETS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-5 overflow-x-auto rounded-lg border border-[#D8E7F7] overscroll-x-contain">
            <div className="grid min-w-[520px] grid-cols-[minmax(130px,1.4fr)_repeat(5,minmax(62px,.65fr))] gap-px bg-[#D8E7F7] text-[10px] font-bold text-slate-500">
              <div className="bg-[#F6FAFF] px-3 py-2.5">功能模块</div>
              {ACTION_ORDER.map(action => <div key={action} className="bg-[#F6FAFF] px-2 py-2.5 text-center">{teamPermissionLabel(action)}</div>)}
            </div>
            {TEAM_PERMISSION_GROUPS.map(group => (
              <div key={group.key} className="contents">
                <div className="col-span-6 border-t border-[#BBD8F5] bg-[#EAF5FF] px-3 py-2">
                  <span className="font-bold text-[#0958D9]">{group.label}</span>
                  <span className="ml-2 font-normal text-slate-500">{group.description}</span>
                </div>
                {group.modules.map(moduleKey => {
                  const moduleDefinition = TEAM_MODULES.find(item => item.key === moduleKey)
                  if (!moduleDefinition) return null
                  return (
                    <div key={moduleDefinition.key} className="col-span-6 grid grid-cols-[minmax(130px,1.4fr)_repeat(5,minmax(62px,.65fr))] gap-px border-t border-[#D8E7F7] bg-[#D8E7F7] text-[11px]">
                      <div className="bg-white px-3 py-3">
                        <div className="font-bold text-slate-800">{moduleDefinition.label}</div>
                        <div className="mt-0.5 text-[9px] leading-4 text-slate-400">{moduleDefinition.description}</div>
                      </div>
                      {ACTION_ORDER.map(action => {
                        const supported = moduleDefinition.actions.includes(action)
                        const checked = supported && hasTeamPermission(permissions, moduleDefinition.key, action)
                        return (
                          <div key={action} className="flex items-center justify-center bg-white px-2 py-3">
                            {supported ? (
                              <button
                                type="button"
                                onClick={() => toggle(moduleDefinition.key, action)}
                                className={cn(
                                  "flex h-6 w-6 items-center justify-center rounded-md border transition",
                                  checked ? "border-[#1677FF] bg-[#1677FF] text-white" : "border-slate-200 bg-white text-transparent hover:border-[#69B1FF]",
                                )}
                                aria-label={`${moduleDefinition.label}${teamPermissionLabel(action)}`}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                            ) : <span className="text-slate-200">-</span>}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[#E2EDF8] bg-[#F8FBFF] px-4 py-3 sm:px-6">
          <div className="text-[10px] text-slate-400">已开放 {TEAM_MODULES.filter(module => hasTeamPermission(permissions, module.key, "view")).length} 个模块</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-600">取消</button>
            <button type="button" onClick={save} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#1677FF] px-4 text-xs font-semibold text-white disabled:opacity-60">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              保存权限
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AuditSection({
  audit,
  members,
}: {
  audit: TeamAuditRecord[]
  members: TeamMemberView[]
}) {
  const names = useMemo(() => new Map(members.map(member => [member.userId, member.name || member.email])), [members])
  return (
    <section className="overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm">
      <SectionTitle icon={Activity} title="团队审计记录" detail="成员、权限和客户共享变更均保留操作人和时间。" />
      <div className="max-h-80 overflow-y-auto">
        {audit.length > 0 ? audit.map(item => (
          <div key={item.id} className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-0 sm:px-5">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#EAF4FF] text-[#1677FF]"><Activity className="h-3.5 w-3.5" /></span>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-700">{AUDIT_LABELS[item.action] || item.action}</div>
                <div className="mt-1 truncate text-[10px] text-slate-400">
                  {names.get(item.actorUserId) || "团队成员"}
                  {item.targetUserId ? ` · 对象：${names.get(item.targetUserId) || "成员"}` : ""}
                  {item.clientId ? ` · 客户：${String(item.metadata.clientName || item.clientId)}` : ""}
                </div>
              </div>
            </div>
            <time className="shrink-0 text-[10px] text-slate-400">{formatTime(item.createdAt)}</time>
          </div>
        )) : <p className="py-10 text-center text-xs text-slate-400">暂无团队变更记录</p>}
      </div>
    </section>
  )
}
