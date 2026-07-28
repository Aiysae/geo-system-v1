import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  FileText,
  Layers3,
  Link2,
  ListChecks,
  ShieldCheck,
} from "lucide-react"
import { notFound, redirect } from "next/navigation"
import {
  ClientExecutionActionDetailError,
  getClientExecutionActionDetail,
} from "@/lib/client-feedback/action-detail"
import { getCurrentUser } from "@/lib/auth"
import type {
  ClientExecutionAction,
  ClientExecutionActionCategory,
} from "@/types/client-feedback"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "执行动作详情 · 势途 GEO",
  description: "查看客户项目的执行动作和证据明细",
  robots: { index: false, follow: false, noarchive: true },
}

const CATEGORY_LABELS: Record<ClientExecutionActionCategory, string> = {
  penetration_check: "疑问句检测",
  content_production: "内容生产",
  self_media_publish: "自媒体发布",
  authority_media_publish: "权威媒体发布",
  video_publish: "视频发布",
  website_optimization: "网站优化",
  strategy_adjustment: "策略调整",
  client_communication: "客户沟通",
  other: "其他动作",
}

function shanghaiDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function statusLabel(action: ClientExecutionAction): string {
  return action.status === "completed" ? "已完成" : "计划中"
}

export default async function ClientExecutionActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ actionId: string }>
  searchParams: Promise<{ clientId?: string }>
}) {
  const user = await getCurrentUser()
  const { actionId } = await params
  const query = await searchParams
  const clientId = String(query.clientId || "").trim()
  const currentPath = `/workspace/actions/${encodeURIComponent(actionId)}?clientId=${encodeURIComponent(clientId)}`
  if (!user) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(currentPath)}`)
  }
  if (user.mustChangePassword) {
    redirect(`/forgot-password?email=${encodeURIComponent(user.email)}&managed=1`)
  }
  if (!clientId) notFound()

  let detail: Awaited<ReturnType<typeof getClientExecutionActionDetail>>
  try {
    detail = await getClientExecutionActionDetail({
      userId: user.id,
      clientId,
      actionId,
    })
  } catch (error) {
    if (error instanceof ClientExecutionActionDetailError) notFound()
    notFound()
  }

  const returnParams = new URLSearchParams({
    clientId: detail.clientId,
    module: "feedback",
    date: shanghaiDate(detail.action.occurredAt),
  })
  if (detail.teamId) returnParams.set("teamId", detail.teamId)
  const returnHref = `/workspace?${returnParams.toString()}`
  const isBatch = detail.relatedActions.length > 1
  const title = detail.kind === "publication" && isBatch
    ? `${CATEGORY_LABELS[detail.action.category]} · ${detail.totalQuantity}${detail.unit}`
    : detail.action.title

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#EAF5FF_0%,#F7FBFF_32%,#EDF4FA_100%)] text-[#102A43]">
      <header className="sticky top-0 z-30 border-b border-white/15 bg-[linear-gradient(100deg,#001D66_0%,#075BDB_52%,#00AEEA_100%)] px-3 py-3 text-white shadow-sm sm:px-6">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3">
          <Link
            href={returnHref}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 text-xs font-semibold transition hover:bg-white/18 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <ArrowLeft className="h-4 w-4" />
            返回执行日历
          </Link>
          <div className="flex min-w-0 items-center gap-2 text-right">
            <ShieldCheck className="h-4 w-4 shrink-0 text-cyan-200" />
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold">执行事实记录</div>
              <div className="truncate text-[10px] text-cyan-50/70">内容与证据来自当次保存记录</div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1180px] px-3 py-5 sm:px-6 sm:py-8">
        <section className="overflow-hidden rounded-lg border border-[#CFE1F1] bg-white shadow-[0_18px_45px_-36px_rgba(0,54,120,.55)]">
          <div className="border-b border-[#DCEAF5] bg-[linear-gradient(110deg,#F7FBFF_0%,#E9F5FF_60%,#E8FCFF_100%)] px-5 py-5 sm:px-7 sm:py-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-[#1677FF] px-2.5 py-1 text-[11px] font-semibold text-white">
                {CATEGORY_LABELS[detail.action.category]}
              </span>
              <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                detail.action.status === "completed"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}>
                {statusLabel(detail.action)}
              </span>
            </div>
            <h1 className="mt-3 break-words text-xl font-bold leading-8 text-[#0B2845] sm:text-2xl">
              {title}
            </h1>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#5D7690]">
              <span>{detail.clientName}</span>
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                {formatDateTime(detail.action.occurredAt)}
              </span>
            </div>
            {detail.action.description ? (
              <p className="mt-4 max-w-4xl break-words text-sm leading-7 text-[#49647E]">
                {detail.action.description}
              </p>
            ) : null}
          </div>

          <div className="grid divide-y divide-[#E3EDF6] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="px-5 py-4 sm:px-6">
              <div className="text-[10px] font-semibold text-[#7E91A7]">执行数量</div>
              <div className="mt-1 text-2xl font-bold text-[#075BDB]">
                {detail.totalQuantity}
                <span className="ml-1 text-xs font-semibold text-[#5D7690]">{detail.unit}</span>
              </div>
            </div>
            <div className="px-5 py-4 sm:px-6">
              <div className="text-[10px] font-semibold text-[#7E91A7]">明细记录</div>
              <div className="mt-1 text-2xl font-bold text-[#00A6C7]">
                {detail.itemCount}
                <span className="ml-1 text-xs font-semibold text-[#5D7690]">项</span>
              </div>
            </div>
            <div className="px-5 py-4 sm:px-6">
              <div className="text-[10px] font-semibold text-[#7E91A7]">涉及平台</div>
              <div className="mt-1 text-2xl font-bold text-[#13A66B]">
                {detail.platforms.length}
                <span className="ml-1 text-xs font-semibold text-[#5D7690]">个</span>
              </div>
            </div>
          </div>
        </section>

        {detail.platforms.length > 0 ? (
          <section className="mt-5 rounded-lg border border-[#D7E5F2] bg-white px-5 py-5 sm:px-6">
            <div className="flex items-center gap-2">
              <Layers3 className="h-4 w-4 text-[#1677FF]" />
              <h2 className="text-sm font-bold">平台分布</h2>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {detail.platforms.map(platform => (
                <span key={platform.name} className="inline-flex items-center gap-2 rounded-md border border-[#D7E8F7] bg-[#F3F9FF] px-3 py-2 text-xs font-semibold text-[#285A88]">
                  {platform.name}
                  <span className="text-[#1677FF]">{platform.count}</span>
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {detail.kind === "publication" ? (
          <section className="mt-5 overflow-hidden rounded-lg border border-[#D7E5F2] bg-white">
            <header className="flex items-center justify-between gap-3 border-b border-[#E3EDF6] px-5 py-4 sm:px-6">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold">
                  <ListChecks className="h-4 w-4 text-[#13C2C2]" />
                  发布内容明细
                </h2>
                <p className="mt-1 text-[11px] text-[#7E91A7]">标题和网址均来自已保存的执行证据</p>
              </div>
              <span className="text-xs font-semibold text-[#1677FF]">{detail.evidence.length} 条</span>
            </header>
            {detail.evidence.length > 0 ? (
              <div className="divide-y divide-[#E8F0F6]">
                {detail.evidence.map((item, index) => (
                  <article key={`${item.actionId}:${item.url}`} className="grid gap-3 px-5 py-4 sm:grid-cols-[34px_1fr_auto] sm:items-center sm:px-6">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#EDF5FF] font-mono text-xs font-bold text-[#1677FF]">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <h3 className="break-words text-sm font-semibold leading-6 text-[#183B5B]">{item.label}</h3>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#7E91A7]">
                        {item.platform ? <span>{item.platform}</span> : null}
                        <span>{formatDateTime(item.occurredAt)}</span>
                      </div>
                    </div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg border border-[#B8D8F4] bg-white px-3 text-xs font-semibold text-[#096DD9] transition hover:bg-[#F0F8FF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1677FF]"
                    >
                      打开文章
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </article>
                ))}
              </div>
            ) : (
              <div className="px-5 py-12 text-center text-xs text-[#7E91A7]">
                该动作记录了发布数量，但还没有保存文章网址。
              </div>
            )}
          </section>
        ) : (
          <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_.86fr]">
            <div className="rounded-lg border border-[#D7E5F2] bg-white px-5 py-5 sm:px-6">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <FileText className="h-4 w-4 text-[#1677FF]" />
                动作内容
              </h2>
              <div className="mt-4 space-y-3">
                {detail.relatedActions.map(action => (
                  <article key={action.id} className="border-l-2 border-[#6EC8FF] pl-4">
                    <h3 className="break-words text-sm font-semibold text-[#183B5B]">{action.title}</h3>
                    {action.description ? <p className="mt-1 break-words text-xs leading-6 text-[#5D7690]">{action.description}</p> : null}
                    <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-[#8AA0B5]">
                      <span>{formatDateTime(action.occurredAt)}</span>
                      {action.platform ? <span>{action.platform}</span> : null}
                      {typeof action.quantity === "number" ? <span>{action.quantity} {action.unit || ""}</span> : null}
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-[#D7E5F2] bg-white px-5 py-5 sm:px-6">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <Link2 className="h-4 w-4 text-[#13C2C2]" />
                证据与材料
              </h2>
              {detail.evidence.length > 0 ? (
                <div className="mt-4 divide-y divide-[#E8F0F6]">
                  {detail.evidence.map(item => (
                    <a
                      key={`${item.actionId}:${item.url}`}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-start justify-between gap-3 py-3 text-xs font-semibold text-[#096DD9] hover:underline"
                    >
                      <span className="min-w-0 break-words">{item.label}</span>
                      <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    </a>
                  ))}
                </div>
              ) : (
                <div className="mt-4 flex items-start gap-2 rounded-lg bg-[#F5F9FC] px-4 py-4 text-xs leading-6 text-[#6B8299]">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#13A66B]" />
                  本次动作已保存执行说明，暂未附加外部证据网址。
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
