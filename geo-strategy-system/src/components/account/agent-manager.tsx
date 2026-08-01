"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  CircleCheck,
  Clipboard,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  Trash2,
} from "lucide-react"
import {
  AGENT_INTEGRATIONS,
  integrationByKey,
  integrationConfig,
  type AgentIntegrationKey,
} from "@/lib/agent/integration-catalog"
import type { AgentAccessEligibility, AgentAuditRecord, AgentScope, AgentTokenRecord } from "@/types/agent"

type AgentClient = {
  clientId: string
  clientName: string
  ourBrand: string
  teamId?: string
  teamName?: string
  sourceType: "personal" | "team"
}

type AgentPayload = {
  eligibility: AgentAccessEligibility
  tokens: AgentTokenRecord[]
  audits: AgentAuditRecord[]
  clients: AgentClient[]
  scopes: AgentScope[]
  presets: Record<string, AgentScope[]>
}

const PRESETS = [
  { key: "observer", label: "只读观察", description: "查看客户、任务、结果与报告，不提交任务" },
  { key: "operator", label: "业务执行", description: "运行检测、生成文章与报告，可停止任务" },
  { key: "full", label: "完整授权", description: "包含编辑与管理权限，适合可信的内部 Agent" },
] as const

function clientKey(client: AgentClient): string {
  return `${client.teamId || "personal"}:${client.clientId}`
}

function time(value?: string): string {
  if (!value) return "尚未使用"
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

async function fetchAgentPayload(): Promise<AgentPayload> {
  const response = await fetch("/api/account/agents", { cache: "no-store" })
  const body = await response.json() as AgentPayload & { error?: string }
  if (!response.ok) throw new Error(body.error || "Agent 配置读取失败")
  return body
}

export function AgentManager({ userName }: { userName: string }) {
  const [data, setData] = useState<AgentPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  const [revealedToken, setRevealedToken] = useState("")
  const [copied, setCopied] = useState(false)
  const [name, setName] = useState("我的工作 Agent")
  const [preset, setPreset] = useState("operator")
  const [clientMode, setClientMode] = useState<"all" | "selected">("selected")
  const [selectedClients, setSelectedClients] = useState<string[]>([])
  const [dailyCreditLimit, setDailyCreditLimit] = useState(500)
  const [maxTaskCredits, setMaxTaskCredits] = useState(200)
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(60)
  const [allowedIps, setAllowedIps] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [integrationKey, setIntegrationKey] = useState<AgentIntegrationKey>("codex")
  const [configCopied, setConfigCopied] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionResult, setConnectionResult] = useState<"" | "success" | "failed">("")

  async function load() {
    setLoading(true)
    try {
      const body = await fetchAgentPayload()
      setData(body)
      setRateLimitPerMinute(current => Math.min(current, body.eligibility.maxRateLimitPerMinute))
      setSelectedClients(current => current.length
        ? current
        : body.clients.map(clientKey))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Agent 配置读取失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    void fetchAgentPayload()
      .then(body => {
        if (!active) return
        setData(body)
        setRateLimitPerMinute(current => Math.min(current, body.eligibility.maxRateLimitPerMinute))
        setSelectedClients(body.clients.map(clientKey))
      })
      .catch(error => {
        if (active) setMessage(error instanceof Error ? error.message : "Agent 配置读取失败")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  const selectedGrants = useMemo(() => {
    const selected = new Set(selectedClients)
    return (data?.clients || [])
      .filter(client => selected.has(clientKey(client)))
      .map(client => ({ clientId: client.clientId, teamId: client.teamId }))
  }, [data?.clients, selectedClients])

  async function createToken() {
    if (!data) return
    if (clientMode === "selected" && selectedGrants.length === 0) {
      setMessage("请至少选择一个允许 Agent 访问的客户")
      return
    }
    setSubmitting(true)
    setMessage("")
    setRevealedToken("")
    try {
      const response = await fetch("/api/account/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          scopes: data.presets[preset] || [],
          clientMode,
          clientGrants: clientMode === "selected" ? selectedGrants : [],
          dailyCreditLimit,
          maxTaskCredits,
          rateLimitPerMinute,
          allowedIps: allowedIps.split(/[\s,]+/).map(value => value.trim()).filter(Boolean),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      })
      const body = await response.json() as { token?: string; error?: string }
      if (!response.ok || !body.token) throw new Error(body.error || "Agent 密钥创建失败")
      setRevealedToken(body.token)
      await load()
      setMessage("Agent 密钥已创建。请立即保存，离开页面后无法再次查看明文。")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Agent 密钥创建失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function revoke(tokenId: string) {
    if (!window.confirm("撤销后，使用这枚密钥的 CLI 与 Agent 会立即失去访问权限。确认撤销吗？")) return
    setMessage("")
    const response = await fetch(`/api/account/agents/${encodeURIComponent(tokenId)}`, { method: "DELETE" })
    const body = await response.json() as { error?: string }
    if (!response.ok) {
      setMessage(body.error || "撤销失败")
      return
    }
    await load()
    setMessage("Agent 密钥已撤销")
  }

  async function copyToken() {
    if (!revealedToken) return
    await navigator.clipboard.writeText(revealedToken)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }

  const integration = integrationByKey(integrationKey)
  const generatedConfig = revealedToken ? integrationConfig(integrationKey, revealedToken) : ""

  async function copyConfig() {
    if (!generatedConfig) return
    await navigator.clipboard.writeText(generatedConfig)
    setConfigCopied(true)
    window.setTimeout(() => setConfigCopied(false), 1_500)
  }

  function downloadConfig() {
    if (!generatedConfig) return
    const blob = new Blob([generatedConfig], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = integration.fileName || "shitu-geo-agent.txt"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function testConnection() {
    if (!revealedToken) return
    setTestingConnection(true)
    setConnectionResult("")
    try {
      const headers = { Authorization: `Bearer ${revealedToken}` }
      const [capabilities, clients] = await Promise.all([
        fetch("/api/agent/v1/capabilities", { headers, cache: "no-store" }),
        fetch("/api/agent/v1/clients", { headers, cache: "no-store" }),
      ])
      if (!capabilities.ok || !clients.ok) {
        const body = await (capabilities.ok ? clients : capabilities).json().catch(() => ({})) as { error?: { message?: string } }
        throw new Error(body.error?.message || "Agent 连接测试失败")
      }
      setConnectionResult("success")
      setMessage("连接成功：Agent 已能读取授权能力和客户目录，本次测试不扣积分。")
    } catch (error) {
      setConnectionResult("failed")
      setMessage(error instanceof Error ? error.message : "Agent 连接测试失败")
    } finally {
      setTestingConnection(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F2F7FD] text-slate-900">
      <header className="border-b border-[#CFE4FA] bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/account?tab=settings" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#0958D9]">
            <ArrowLeft className="h-4 w-4" />我的主页
          </Link>
          <Image src="/brand/shitu-lockup-transparent-v2.png" alt="势途 GEO" width={140} height={42} className="h-8 w-auto object-contain" />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
        <section className="overflow-hidden rounded-lg bg-[linear-gradient(118deg,#001D66_0%,#0958D9_46%,#00AEEA_100%)] px-5 py-5 text-white shadow-[0_16px_42px_rgba(9,88,217,.2)] sm:px-7">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-cyan-100"><Bot className="h-4 w-4" />Agent 控制台</div>
              <h1 className="mt-2 text-2xl font-bold">让 Agent 安全操作势途 GEO</h1>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-blue-50/75">为 {userName} 创建独立密钥，按客户、模块和积分预算授权。Agent 产生的任务、积分和报告与网页端完全一致，并保留审计记录。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/agent" className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-3 text-xs font-semibold text-white">接入说明<ExternalLink className="h-3.5 w-3.5" /></Link>
              <a href="/api/agent/v1/openapi.json" target="_blank" rel="noreferrer" className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-[#0958D9] shadow-sm">
                OpenAPI 文档<ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </section>

        {message ? <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-medium text-blue-800">{message}</div> : null}
        {loading ? <div className="flex min-h-64 items-center justify-center text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />读取 Agent 配置</div> : null}

        {!loading && data ? (
          <>
            <section className="mt-5 overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm">
              <div className="grid border-b border-[#D8E7F7] sm:grid-cols-4">
                {[
                  { label: "选择 Agent", done: true },
                  { label: "设置权限", done: Boolean(data.clients.length) },
                  { label: "复制配置", done: Boolean(revealedToken) },
                  { label: "测试连接", done: connectionResult === "success" },
                ].map((step, index) => (
                  <div key={step.label} className="flex min-h-14 items-center gap-2 border-b border-[#E8F1FA] px-4 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${step.done ? "bg-[#1677FF] text-white" : "bg-slate-100 text-slate-400"}`}>{step.done ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>
                    <span className="text-xs font-semibold text-slate-700">{step.label}</span>
                  </div>
                ))}
              </div>
              <div className="p-5">
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><p className="text-xs font-bold text-[#1677FF]">第 1 步</p><h2 className="mt-1 text-base font-bold">选择你要接入的 Agent</h2></div><p className="text-xs text-slate-500">后面会自动生成对应配置</p></div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {AGENT_INTEGRATIONS.map(item => {
                    const selected = integrationKey === item.key
                    return <button key={item.key} type="button" onClick={() => {
                      setIntegrationKey(item.key)
                      setConnectionResult("")
                      if (name === "我的工作 Agent" || name.includes("· 工作 Agent")) setName(`${item.shortLabel} · 工作 Agent`)
                    }} className={`relative min-h-20 rounded-lg border px-3 py-3 text-left transition ${selected ? "border-[#1677FF] bg-[#F0F7FF] ring-2 ring-blue-100" : "border-slate-200 hover:border-[#69B1FF]"}`}>
                      <span className="flex items-center gap-2 text-xs font-bold"><Bot className={`h-4 w-4 ${selected ? "text-[#1677FF]" : "text-slate-400"}`} />{item.label}{item.recommended ? <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[9px] text-cyan-700">推荐</span> : null}</span>
                      <span className="mt-1.5 block text-[10px] leading-4 text-slate-500">{item.description}</span>
                    </button>
                  })}
                </div>
              </div>
            </section>

          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
            <section className="rounded-lg border border-[#D8E7F7] bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div><p className="text-[10px] font-bold text-[#1677FF]">第 2 步</p><h2 className="mt-1 text-sm font-bold">创建 Agent 密钥</h2><p className="mt-1 text-xs text-slate-500">建议从“业务执行”开始，只授权需要操作的客户。</p></div>
                <KeyRound className="h-5 w-5 text-[#1677FF]" />
              </div>

              {!data.eligibility.canCreateTokens ? <div className="mt-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{data.eligibility.reason || "Agent 自助接入当前未开放"}</div> : null}

              <label className="mt-5 block text-xs font-semibold text-slate-700">密钥名称</label>
              <input value={name} onChange={event => setName(event.target.value)} maxLength={100} className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-blue-100" />

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {PRESETS.filter(item => Boolean(data.presets[item.key])).map(item => (
                  <button key={item.key} type="button" onClick={() => setPreset(item.key)} className={`min-h-24 rounded-lg border p-3 text-left transition ${preset === item.key ? "border-[#1677FF] bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 hover:border-blue-300"}`}>
                    <span className="text-xs font-bold text-slate-900">{item.label}</span>
                    <span className="mt-1.5 block text-[11px] leading-4 text-slate-500">{item.description}</span>
                  </button>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between gap-4">
                <div><p className="text-xs font-semibold text-slate-700">客户范围</p><p className="mt-1 text-[11px] text-slate-500">生产环境建议只授权必要客户。</p></div>
                <div className="inline-flex rounded-lg bg-slate-100 p-1">
                  <button type="button" onClick={() => setClientMode("selected")} className={`h-8 whitespace-nowrap rounded-md px-3 text-xs font-semibold ${clientMode === "selected" ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-500"}`}>指定客户</button>
                  <button type="button" onClick={() => setClientMode("all")} className={`h-8 whitespace-nowrap rounded-md px-3 text-xs font-semibold ${clientMode === "all" ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-500"}`}>全部客户</button>
                </div>
              </div>
              {clientMode === "selected" ? (
                <div className="mt-3 grid max-h-52 gap-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2">
                  {data.clients.map(client => {
                    const key = clientKey(client)
                    const selected = selectedClients.includes(key)
                    return <button key={key} type="button" onClick={() => setSelectedClients(current => selected ? current.filter(value => value !== key) : [...current, key])} className={`flex min-h-14 items-center gap-2 rounded-lg border px-3 text-left ${selected ? "border-blue-300 bg-white" : "border-transparent bg-transparent"}`}>
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? "border-[#1677FF] bg-[#1677FF] text-white" : "border-slate-300 bg-white"}`}>{selected ? <Check className="h-3.5 w-3.5" /> : null}</span>
                      <span className="min-w-0"><span className="block truncate text-xs font-semibold">{client.clientName}</span><span className="block truncate text-[10px] text-slate-400">{client.teamName || client.ourBrand || "个人空间"}</span></span>
                    </button>
                  })}
                </div>
              ) : null}

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <NumberField label="每日积分上限" value={dailyCreditLimit} onChange={setDailyCreditLimit} min={0} max={1_000_000} />
                <NumberField label="单任务积分上限" value={maxTaskCredits} onChange={setMaxTaskCredits} min={0} max={1_000_000} />
                <NumberField label="每分钟请求数" value={rateLimitPerMinute} onChange={setRateLimitPerMinute} min={1} max={data.eligibility.maxRateLimitPerMinute} />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-700">IP 白名单（可选）<input value={allowedIps} onChange={event => setAllowedIps(event.target.value)} placeholder="网络或 VPN 会变动时请留空" className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs font-normal outline-none focus:border-[#1677FF]" /></label>
                <label className="text-xs font-semibold text-slate-700">到期时间（可选）<input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs font-normal outline-none focus:border-[#1677FF]" /></label>
              </div>
              <button type="button" onClick={() => void createToken()} disabled={submitting || !data.eligibility.canCreateTokens} className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}创建密钥
              </button>

              {revealedToken ? (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-bold text-amber-900">仅展示这一次</p>
                  <code className="mt-2 block break-all rounded-md bg-slate-950 p-3 text-[11px] leading-5 text-cyan-200">{revealedToken}</code>
                  <button type="button" onClick={() => void copyToken()} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}{copied ? "已复制" : "复制密钥"}
                  </button>

                  <div className="mt-5 border-t border-amber-200 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] font-bold text-[#1677FF]">第 3 步</p><p className="mt-1 text-xs font-bold text-slate-900">{integration.label} 配置</p><p className="mt-1 text-[10px] text-slate-500">放置位置：{integration.setupLocation}</p></div><span className="rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">Streamable HTTP</span></div>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[#071E41] p-3 text-[10px] leading-5 text-cyan-100">{generatedConfig}</pre>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => void copyConfig()} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-xs font-semibold text-[#0958D9] ring-1 ring-blue-200">{configCopied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}{configCopied ? "已复制" : "复制配置"}</button>
                      <button type="button" onClick={downloadConfig} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-xs font-semibold text-slate-700 ring-1 ring-slate-200"><Download className="h-3.5 w-3.5" />下载配置</button>
                      <button type="button" onClick={() => void testConnection()} disabled={testingConnection} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#1677FF] px-3 text-xs font-semibold text-white disabled:opacity-60">{testingConnection ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : connectionResult === "success" ? <CircleCheck className="h-3.5 w-3.5" /> : <PlugZap className="h-3.5 w-3.5" />}{testingConnection ? "正在测试" : connectionResult === "success" ? "连接成功" : "测试连接"}</button>
                    </div>
                    <p className="mt-3 text-[10px] leading-4 text-amber-800">测试只读取权限和客户目录，不调用 AI，不扣积分。密钥不会写入网站本地存储，关闭页面后无法找回。</p>
                  </div>
                </div>
              ) : null}
            </section>

            <div className="space-y-5">
              <section className="rounded-lg border border-[#D8E7F7] bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between"><div><h2 className="text-sm font-bold">已创建密钥</h2><p className="mt-1 text-xs text-slate-500">撤销优先于删除，审计记录会继续保留。</p></div><button type="button" onClick={() => { setMessage(""); void load() }} className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500" title="刷新"><RefreshCw className="h-3.5 w-3.5" /></button></div>
                <div className="mt-4 space-y-2">
                  {data.tokens.length === 0 ? <Empty icon={KeyRound} text="还没有 Agent 密钥" /> : data.tokens.map(token => (
                    <div key={token.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-bold">{token.name}</p><code className="mt-1 block text-[10px] text-slate-400">{token.tokenPrefix}</code></div><span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${token.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{token.status === "active" ? "使用中" : "已撤销"}</span></div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-slate-500"><span>每日 {token.dailyCreditLimit} 积分</span><span>单任务 {token.maxTaskCredits} 积分</span><span>{token.scopes.length} 项权限</span><span>{time(token.lastUsedAt)}</span></div>
                      {token.status === "active" ? <button type="button" onClick={() => void revoke(token.id)} className="mt-3 inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" />撤销</button> : null}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-[#D8E7F7] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#1677FF]" /><h2 className="text-sm font-bold">最近审计</h2></div>
                <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
                  {data.audits.length === 0 ? <Empty icon={TerminalSquare} text="尚无 Agent 调用记录" /> : data.audits.slice(0, 30).map(entry => (
                    <div key={entry.id} className="border-b border-slate-100 pb-2 text-[11px] last:border-0"><div className="flex items-center justify-between gap-2"><code className="truncate font-semibold text-slate-700">{entry.action}</code><span className={entry.status === "succeeded" ? "text-emerald-600" : entry.status === "accepted" ? "text-blue-600" : "text-rose-600"}>{entry.status}</span></div><p className="mt-1 truncate text-slate-400">{time(entry.createdAt)} · {entry.traceId}</p></div>
                  ))}
                </div>
              </section>
            </div>
          </div>
          <section className="mt-5 overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm">
            <div className="flex flex-col justify-between gap-2 border-b border-[#E8F1FA] px-5 py-4 sm:flex-row sm:items-center">
              <div><h2 className="text-sm font-bold">连接状态与处理方法</h2><p className="mt-1 text-xs text-slate-500">当前账号可创建 {data.eligibility.maxActiveTokens} 枚有效密钥，单密钥最高 {data.eligibility.maxRateLimitPerMinute} 次/分钟。</p></div>
              <span className="rounded-md bg-[#EAF4FF] px-2.5 py-1 text-[10px] font-bold text-[#0958D9]">{data.eligibility.tier === "admin" ? "管理员" : data.eligibility.tier.toUpperCase()}</span>
            </div>
            <div className="grid divide-y divide-[#E8F1FA] md:grid-cols-4 md:divide-x md:divide-y-0">
              {[{ code: "401", title: "密钥无效", detail: "检查是否已撤销或过期，必要时创建新密钥。" }, { code: "403", title: "客户或功能未授权", detail: "重新创建密钥并选择需要的客户和业务权限。" }, { code: "IP", title: "换网络后无法连接", detail: "VPN 或动态网络会更换 IP；没有固定出口时请留空白名单。" }, { code: "429", title: "请求过快", detail: "让 Agent 稍后重试，后台任务不会因等待而中断。" }].map(item => <div key={item.code} className="p-5"><code className="text-xs font-bold text-[#1677FF]">{item.code === "IP" ? "IP 白名单" : `HTTP ${item.code}`}</code><h3 className="mt-2 text-xs font-bold">{item.title}</h3><p className="mt-1.5 text-[11px] leading-5 text-slate-500">{item.detail}</p></div>)}
            </div>
          </section>
          </>
        ) : null}
      </main>
    </div>
  )
}

function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number }) {
  return <label className="text-xs font-semibold text-slate-700">{label}<input type="number" value={value} min={min} max={max} onChange={event => onChange(Number(event.target.value))} className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs font-normal outline-none focus:border-[#1677FF]" /></label>
}

function Empty({ icon: Icon, text }: { icon: typeof KeyRound; text: string }) {
  return <div className="flex min-h-24 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400"><Icon className="mb-2 h-5 w-5" />{text}</div>
}
