"use client"

import { useMemo, useState, useTransition } from "react"
import type { FormEvent } from "react"
import { useRouter } from "next/navigation"
import {
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleAlert,
  CloudCog,
  FilePenLine,
  Gauge,
  KeyRound,
  Loader2,
  MessageSquareText,
  PenLine,
  Plus,
  Power,
  RefreshCw,
  SearchCheck,
  Settings2,
  Sparkles,
  Trash2,
  WandSparkles,
  Wifi,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import {
  deleteModelConnectionAction,
  saveModelConnectionAction,
  setPrimaryModelAction,
  syncAllModelConnectionsAction,
  syncModelConnectionAction,
  testModelConnectionAction,
  toggleConnectionModelAction,
  toggleModelConnectionAction,
  type ModelCenterActionResult,
} from "./actions"
import type { AiProviderPublicSetting } from "@/types/ai-settings"
import type {
  AiGatewayPreset,
  AiGatewayProviderPublic,
  AiGatewayVendor,
} from "@/types/ai-gateway"

type FeatureKey =
  | "all"
  | "penetration"
  | "research"
  | "diagnosis"
  | "difficulty"
  | "judge"
  | "keywords"
  | "questions"
  | "article"
  | "rewrite"
  | "batch"

interface FeatureEntry {
  key: FeatureKey
  label: string
  caption: string
  icon: LucideIcon
  vendors: AiGatewayVendor[]
}

type RunAction = (
  action: () => Promise<ModelCenterActionResult>,
  onComplete?: (result: ModelCenterActionResult) => void,
) => void

const ALL_OFFICIAL_VENDORS: AiGatewayVendor[] = [
  "openai", "anthropic", "gemini", "doubao", "qwen", "hunyuan", "deepseek", "kimi", "ernie",
]

const FEATURES: FeatureEntry[] = [
  { key: "penetration", label: "渗透率检测", caption: "联网回答与品牌监测", icon: SearchCheck, vendors: ["doubao", "qwen", "hunyuan", "deepseek", "kimi", "ernie"] },
  { key: "research", label: "独立调研", caption: "市场与竞品资料", icon: BrainCircuit, vendors: ["doubao", "qwen", "hunyuan", "deepseek", "kimi", "ernie"] },
  { key: "diagnosis", label: "AI 诊断", caption: "诊断与策略建议", icon: Gauge, vendors: ["doubao", "qwen", "hunyuan", "deepseek", "kimi", "ernie"] },
  { key: "difficulty", label: "难度测评", caption: "行业与执行难度", icon: Sparkles, vendors: ["doubao", "qwen", "hunyuan", "deepseek", "kimi", "ernie"] },
  { key: "judge", label: "AI 裁判", caption: "品牌与结果结构化", icon: Bot, vendors: ["doubao", "qwen", "hunyuan", "deepseek", "kimi", "ernie"] },
  { key: "keywords", label: "关键词策略", caption: "关键词与发文策略", icon: WandSparkles, vendors: ["qwen", "doubao", "deepseek"] },
  { key: "questions", label: "疑问句生成", caption: "意图化问题池", icon: MessageSquareText, vendors: ["qwen", "doubao"] },
  { key: "article", label: "文章生成", caption: "单篇内容生成", icon: PenLine, vendors: ALL_OFFICIAL_VENDORS },
  { key: "rewrite", label: "文章改写", caption: "链接读取与原创改写", icon: FilePenLine, vendors: ALL_OFFICIAL_VENDORS },
  { key: "batch", label: "批量生成", caption: "独立任务批量生产", icon: CloudCog, vendors: ALL_OFFICIAL_VENDORS },
]

const VENDOR_MARKS: Record<Exclude<AiGatewayVendor, "relay">, { mark: string; tone: string }> = {
  openai: { mark: "GPT", tone: "bg-emerald-500 text-white" },
  anthropic: { mark: "C", tone: "bg-orange-500 text-white" },
  gemini: { mark: "G", tone: "bg-gradient-to-br from-blue-500 to-fuchsia-500 text-white" },
  doubao: { mark: "豆", tone: "bg-violet-600 text-white" },
  qwen: { mark: "Q", tone: "bg-blue-600 text-white" },
  hunyuan: { mark: "混", tone: "bg-cyan-600 text-white" },
  deepseek: { mark: "DS", tone: "bg-indigo-600 text-white" },
  kimi: { mark: "K", tone: "bg-slate-900 text-white" },
  ernie: { mark: "文", tone: "bg-sky-500 text-white" },
}

export function AiModelCenter({
  officialPresets,
  relayPresets,
  connections,
  legacySettings,
}: {
  officialPresets: AiGatewayPreset[]
  relayPresets: AiGatewayPreset[]
  connections: AiGatewayProviderPublic[]
  legacySettings: AiProviderPublicSetting[]
}) {
  const router = useRouter()
  const [feature, setFeature] = useState<FeatureKey>("all")
  const [message, setMessage] = useState<ModelCenterActionResult | null>(null)
  const [working, startTransition] = useTransition()
  const officialConnections = connections.filter(item => item.channel === "official")
  const relayConnections = connections.filter(item => item.channel === "relay")
  const activeFeature = FEATURES.find(item => item.key === feature)
  const visiblePresets = feature === "all"
    ? officialPresets
    : officialPresets.filter(item => activeFeature?.vendors.includes(item.vendor))
  const configuredCount = officialConnections.filter(item => item.hasApiKey && item.enabled).length
  const availableModelCount = connections.reduce(
    (sum, item) => sum + item.models.filter(model => model.enabled && model.status === "available").length,
    0,
  )

  function run(
    action: () => Promise<ModelCenterActionResult>,
    onComplete?: (result: ModelCenterActionResult) => void,
  ) {
    setMessage(null)
    startTransition(async () => {
      const result = await action()
      setMessage(result)
      onComplete?.(result)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl bg-white shadow-xl shadow-blue-950/8 ring-1 ring-white/80">
        <div className="bg-gradient-to-r from-[#0958D9] via-[#1677FF] to-[#13C2C2] px-5 py-5 text-white md:px-7">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-semibold text-blue-100">AI MODEL CENTER</div>
              <h1 className="mt-1 text-2xl font-bold">AI 模型中心</h1>
              <p className="mt-1 text-sm text-blue-50/90">统一管理官方模型和中转站，按功能快速定位配置入口。</p>
            </div>
            <button
              type="button"
              disabled={working || connections.length === 0}
              onClick={() => run(syncAllModelConnectionsAction)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-[#0958D9] shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              一键更新全部模型
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-slate-100 bg-white px-4 py-4 text-center">
          <Metric value={`${configuredCount}/9`} label="官方渠道" />
          <Metric value={String(relayConnections.length)} label="中转站" />
          <Metric value={String(availableModelCount)} label="可用模型" />
        </div>
      </section>

      {message ? (
        <div className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ring-1 ${message.ok ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-rose-50 text-rose-800 ring-rose-200"}`}>
          {message.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{message.ok ? message.message : message.error}</span>
        </div>
      ) : null}

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 md:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">按功能配置</h2>
            <p className="mt-1 text-xs text-slate-500">点击功能，只显示适合该功能的模型渠道。</p>
          </div>
          {feature !== "all" ? (
            <button type="button" onClick={() => setFeature("all")} className="text-xs font-medium text-[#1677FF] hover:text-[#0958D9]">
              显示全部
            </button>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {FEATURES.map(item => {
            const Icon = item.icon
            const selected = feature === item.key
            return (
              <button
                type="button"
                key={item.key}
                onClick={() => setFeature(item.key)}
                className={`flex min-h-16 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${selected ? "border-[#1677FF] bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50"}`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-[#1677FF] text-white" : "bg-slate-100 text-slate-600"}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500">{item.caption}</span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{activeFeature ? `${activeFeature.label} · 推荐渠道` : "官方模型"}</h2>
            <p className="mt-1 text-xs text-slate-500">官方渠道只需填写 API Key；保存后可同步并选择具体模型。</p>
          </div>
          <span className="hidden text-xs text-slate-400 sm:inline">{visiblePresets.length} 个渠道</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {visiblePresets.map(preset => (
            <ConnectionCard
              key={preset.key}
              preset={preset}
              connection={officialConnections.find(item => item.vendor === preset.vendor)}
              legacySetting={legacySettings.find(item => item.key === preset.vendor)}
              working={working}
              run={run}
            />
          ))}
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-cyan-50 px-4 py-3 text-xs leading-relaxed text-cyan-900 ring-1 ring-cyan-200">
          <Wifi className="mt-0.5 h-4 w-4 shrink-0" />
          <p>网站服务器不会使用你电脑上的 VPN。海外官方接口无法连通时，请在下方配置可从中国大陆访问的中转站。</p>
        </div>
      </section>

      <RelaySection
        presets={relayPresets}
        connections={relayConnections}
        working={working}
        run={run}
      />
    </div>
  )
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-mono text-xl font-bold text-slate-900">{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{label}</div>
    </div>
  )
}

function ConnectionCard({
  preset,
  connection,
  legacySetting,
  working,
  run,
}: {
  preset: AiGatewayPreset
  connection?: AiGatewayProviderPublic
  legacySetting?: AiProviderPublicSetting
  working: boolean
  run: RunAction
}) {
  const [editing, setEditing] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl || preset.baseUrl)
  const [manualModels, setManualModels] = useState("")
  const [botId, setBotId] = useState(String(legacySetting?.extra.botId || ""))
  const [appId, setAppId] = useState(String(legacySetting?.extra.appId || ""))
  const availableModels = useMemo(
    () => connection?.models.filter(model => model.status === "available") || [],
    [connection],
  )
  const primaryRemoved = Boolean(
    connection?.primaryModel
      && connection.models.some(model => model.id === connection.primaryModel && model.status === "removed"),
  )
  const mark = preset.vendor === "relay" ? { mark: "API", tone: "bg-cyan-600 text-white" } : VENDOR_MARKS[preset.vendor]
  const configured = Boolean(connection?.hasApiKey)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData()
    if (connection) data.set("id", connection.id)
    data.set("preset", preset.key)
    data.set("name", connection?.name || preset.label)
    data.set("apiKey", apiKey)
    data.set("baseUrl", baseUrl)
    data.set("manualModels", manualModels)
    data.set("botId", botId)
    data.set("appId", appId)
    data.set("primaryModel", connection?.primaryModel || preset.defaultModel || "")
    run(() => saveModelConnectionAction(data), result => {
      if (!result.ok) return
      setEditing(false)
      setApiKey("")
    })
  }

  return (
    <article className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${mark.tone}`}>{mark.mark}</span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-slate-900">{connection?.name || preset.label}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                <StatusPill connection={connection} legacyConfigured={Boolean(legacySetting?.hasApiKey)} />
                {connection?.apiKeyPreview ? <span className="font-mono text-slate-400">{connection.apiKeyPreview}</span> : null}
              </div>
            </div>
          </div>
          {connection ? (
            <button
              type="button"
              title={connection.enabled ? "停用渠道" : "启用渠道"}
              disabled={working}
              onClick={() => run(() => toggleModelConnectionAction(connection.id, !connection.enabled))}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${connection.enabled ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100" : "bg-slate-100 text-slate-400 hover:bg-slate-200"}`}
            >
              <Power className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {connection ? (
          <div className="mt-4 grid grid-cols-[1fr_auto_auto] gap-2">
            <label className="min-w-0">
              <span className="sr-only">主模型</span>
              <select
                value={connection.primaryModel || ""}
                disabled={working || availableModels.length === 0}
                onChange={event => run(() => setPrimaryModelAction(connection.id, event.target.value))}
                className={`h-9 w-full rounded-lg border bg-white px-2.5 text-xs outline-none focus:border-[#1677FF] ${primaryRemoved ? "border-rose-300 text-rose-700" : "border-slate-200 text-slate-700"}`}
              >
                {!connection.primaryModel ? <option value="">选择主模型</option> : null}
                {availableModels.filter(model => model.enabled).map(model => (
                  <option key={model.id} value={model.id}>{model.displayName}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              title="测试线路和实际生成"
              disabled={working}
              onClick={() => run(() => testModelConnectionAction(connection.id))}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-200 bg-cyan-50 text-cyan-700 transition hover:bg-cyan-100 disabled:opacity-60"
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
            </button>
            <button
              type="button"
              title="更新模型列表"
              disabled={working}
              onClick={() => run(() => syncModelConnectionAction(connection.id))}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-[#1677FF] transition hover:bg-blue-100 disabled:opacity-60"
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          </div>
        ) : null}

        {primaryRemoved ? (
          <p className="mt-2 text-xs text-rose-600">当前主模型已下架，请手动选择其他模型。</p>
        ) : null}
        {connection?.healthMessage ? (
          <p className={`mt-2 line-clamp-3 text-[11px] leading-relaxed ${connection.healthStatus === "unhealthy" ? "text-rose-600" : "text-slate-500"}`}>
            {connection.healthMessage}
          </p>
        ) : null}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(value => !value)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {configured ? "更换 Key" : legacySetting?.hasApiKey ? "导入现有配置" : "配置"}
          </button>
          {connection ? <ModelList connection={connection} working={working} run={run} /> : null}
        </div>
      </div>

      {editing ? (
        <form onSubmit={submit} className="border-t border-blue-100 bg-blue-50/50 p-4">
          <label className="block text-xs font-medium text-slate-700">
            API Key
            <span className="mt-1.5 flex items-center rounded-lg border border-slate-200 bg-white px-3 focus-within:border-[#1677FF] focus-within:ring-2 focus-within:ring-blue-100">
              <KeyRound className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                type="password"
                value={apiKey}
                onChange={event => setApiKey(event.target.value)}
                autoComplete="new-password"
                placeholder={configured ? "留空沿用现有 Key" : legacySetting?.hasApiKey ? "留空导入现有 Key" : "粘贴 API Key"}
                className="h-10 w-full bg-transparent px-2 text-sm outline-none"
              />
            </span>
          </label>
          {preset.channel === "relay" && preset.configurableBaseUrl ? (
            <label className="mt-3 block text-xs font-medium text-slate-700">
              中转站地址
              <input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#1677FF] focus:ring-2 focus:ring-blue-100" />
            </label>
          ) : null}
          <label className="mt-3 block text-xs font-medium text-slate-700">
            手动补充模型（可选）
            <input value={manualModels} onChange={event => setManualModels(event.target.value)} placeholder="多个模型用逗号分隔" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#1677FF] focus:ring-2 focus:ring-blue-100" />
          </label>
          {preset.vendor === "doubao" || preset.vendor === "ernie" ? (
            <details className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-600">
                联网检测配置（可选）
              </summary>
              {preset.vendor === "doubao" ? (
                <label className="mt-3 block text-xs text-slate-600">
                  联网 Bot ID
                  <input value={botId} onChange={event => setBotId(event.target.value)} placeholder="bot-xxxx" className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#1677FF]" />
                </label>
              ) : (
                <label className="mt-3 block text-xs text-slate-600">
                  千帆 App ID
                  <input value={appId} onChange={event => setAppId(event.target.value)} placeholder="可留空" className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#1677FF]" />
                </label>
              )}
            </details>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={working || (!configured && !legacySetting?.hasApiKey && !apiKey.trim())} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#1677FF] px-3 text-xs font-semibold text-white transition hover:bg-[#0958D9] disabled:opacity-50">
              {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              保存并更新模型
            </button>
            {connection ? <button type="button" onClick={() => setEditing(false)} className="h-9 rounded-lg px-3 text-xs text-slate-600 hover:bg-white">取消</button> : null}
          </div>
        </form>
      ) : null}
    </article>
  )
}

function StatusPill({ connection, legacyConfigured }: { connection?: AiGatewayProviderPublic; legacyConfigured: boolean }) {
  if (!connection) {
    return legacyConfigured
      ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 ring-1 ring-amber-200">可导入</span>
      : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">未配置</span>
  }
  if (!connection.enabled) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">已停用</span>
  if (connection.healthStatus === "unhealthy") return <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700 ring-1 ring-rose-200">需检查</span>
  if (connection.healthStatus === "unchecked") return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 ring-1 ring-amber-200">待测试</span>
  return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 ring-1 ring-emerald-200">已连通</span>
}

function ModelList({
  connection,
  working,
  run,
}: {
  connection: AiGatewayProviderPublic
  working: boolean
  run: RunAction
}) {
  const available = connection.models.filter(model => model.status === "available")
  const removed = connection.models.filter(model => model.status === "removed")
  return (
    <details className="group relative">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-[#1677FF] transition hover:bg-blue-50 [&::-webkit-details-marker]:hidden">
        模型 {available.length}
        <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
      </summary>
      <div className="absolute left-0 top-9 z-20 max-h-72 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-2xl">
        {available.length === 0 ? <p className="px-2 py-4 text-center text-xs text-slate-500">请先更新模型列表</p> : null}
        {available.map(model => (
          <label key={model.id} className="flex min-h-9 items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50">
            <input
              type="checkbox"
              checked={model.enabled}
              disabled={working || model.id === connection.primaryModel}
              onChange={event => run(() => toggleConnectionModelAction(connection.id, model.id, event.target.checked))}
              className="h-4 w-4 rounded border-slate-300 text-[#1677FF]"
            />
            <span className="min-w-0 flex-1 break-all text-slate-700">{model.displayName}</span>
            {model.id === connection.primaryModel ? <span className="text-[10px] text-[#1677FF]">主模型</span> : null}
          </label>
        ))}
        {removed.length > 0 ? (
          <div className="mt-2 border-t border-slate-100 px-2 pt-2 text-[11px] text-rose-600">{removed.length} 个模型已下架并自动停用</div>
        ) : null}
      </div>
    </details>
  )
}

function RelaySection({
  presets,
  connections,
  working,
  run,
}: {
  presets: AiGatewayPreset[]
  connections: AiGatewayProviderPublic[]
  working: boolean
  run: RunAction
}) {
  const [creating, setCreating] = useState(false)
  const [presetKey, setPresetKey] = useState(presets[0]?.key || "bai")
  const selectedPreset = presets.find(item => item.key === presetKey) || presets[0]
  const [name, setName] = useState(selectedPreset?.label || "")
  const [baseUrl, setBaseUrl] = useState(selectedPreset?.baseUrl || "")
  const [apiKey, setApiKey] = useState("")
  const [manualModels, setManualModels] = useState("")

  function changePreset(key: string) {
    const next = presets.find(item => item.key === key)
    if (!next) return
    setPresetKey(next.key)
    setName(next.label)
    setBaseUrl(next.baseUrl)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPreset) return
    const data = new FormData()
    data.set("preset", selectedPreset.key)
    data.set("name", name)
    data.set("baseUrl", baseUrl)
    data.set("apiKey", apiKey)
    data.set("manualModels", manualModels)
    run(() => saveModelConnectionAction(data), result => {
      if (!result.ok) return
      setCreating(false)
      setApiKey("")
    })
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 md:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">中转站</h2>
          <p className="mt-1 text-xs text-slate-500">填写中转站地址和 API Key，即可同步并使用其模型。</p>
        </div>
        <button type="button" onClick={() => setCreating(value => !value)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-700">
          <Plus className="h-3.5 w-3.5" />
          添加中转站
        </button>
      </div>

      {creating && selectedPreset ? (
        <form onSubmit={submit} className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200 md:grid-cols-2">
          <label className="text-xs font-medium text-slate-700">服务类型
            <select value={presetKey} onChange={event => changePreset(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#1677FF]">
              {presets.map(preset => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700">显示名称
            <input value={name} onChange={event => setName(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#1677FF]" />
          </label>
          <label className="text-xs font-medium text-slate-700">中转站地址
            <input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#1677FF]" />
          </label>
          <label className="text-xs font-medium text-slate-700">API Key
            <input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="new-password" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#1677FF]" />
          </label>
          <label className="text-xs font-medium text-slate-700 md:col-span-2">手动补充模型（可选）
            <input value={manualModels} onChange={event => setManualModels(event.target.value)} placeholder="模型列表接口不可用时填写，多个模型用逗号分隔" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#1677FF]" />
          </label>
          <div className="flex gap-2 md:col-span-2">
            <button type="submit" disabled={working || !apiKey.trim() || !baseUrl.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#1677FF] px-3 text-xs font-semibold text-white disabled:opacity-50">
              {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              保存并更新模型
            </button>
            <button type="button" onClick={() => setCreating(false)} className="h-9 rounded-lg px-3 text-xs text-slate-600 hover:bg-white">取消</button>
          </div>
        </form>
      ) : null}

      {connections.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">暂未添加中转站</div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {connections.map(connection => {
            const preset = presets.find(item => item.key === connection.preset) || presets[presets.length - 1]
            if (!preset) return null
            return (
              <div key={connection.id} className="relative">
                <ConnectionCard preset={preset} connection={connection} working={working} run={run} />
                <button
                  type="button"
                  title="删除中转站"
                  disabled={working}
                  onClick={() => {
                    if (window.confirm(`确认删除“${connection.name}”吗？`)) run(() => deleteModelConnectionAction(connection.id))
                  }}
                  className="absolute right-12 top-4 flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-500 transition hover:bg-rose-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
