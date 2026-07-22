"use client"

import { useActionState, useEffect, useMemo, useState, useTransition } from "react"
import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import {
  Cable,
  CheckCircle2,
  KeyRound,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Save,
  XCircle,
} from "lucide-react"
import {
  saveAiGatewayAction,
  syncAiGatewayModelsAction,
  toggleAiGatewayAction,
  toggleAiGatewayModelAction,
  type SaveAiGatewayState,
} from "./actions"
import type {
  AiGatewayAuthType,
  AiGatewayPreset,
  AiGatewayPresetKey,
  AiGatewayProviderPublic,
} from "@/types/ai-gateway"

const initialState: SaveAiGatewayState = {}
const inputClass = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-blue-100"

export function AiGatewayManager({
  gateways,
  presets,
}: {
  gateways: AiGatewayProviderPublic[]
  presets: AiGatewayPreset[]
}) {
  const [creating, setCreating] = useState(false)
  const defaultPreset = presets[0]

  return (
    <section className="mt-8 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
            <Cable className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">文章模型中转站</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              可同时配置 B.AI 和其他 OpenAI 兼容服务。密钥仅在服务端加密保存。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCreating(value => !value)}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#1677FF] px-3 text-xs font-semibold text-white transition hover:bg-[#0958D9]"
        >
          <Plus className="h-3.5 w-3.5" />
          添加中转站
        </button>
      </div>

      {creating && defaultPreset && (
        <div className="border-b border-blue-100 bg-blue-50/45">
          <GatewayForm
            presets={presets}
            initialPreset={defaultPreset}
            onSaved={() => setCreating(false)}
          />
        </div>
      )}

      {gateways.length === 0 && !creating ? (
        <div className="px-5 py-10 text-center text-sm text-slate-500">
          暂无中转站。添加后即可在文章生成和改写中选择海外模型。
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {gateways.map(gateway => (
            <GatewayForm
              key={`${gateway.id}:${gateway.updatedAt}`}
              gateway={gateway}
              presets={presets}
              initialPreset={presets.find(item => item.key === gateway.preset) || defaultPreset}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function GatewayForm({
  gateway,
  presets,
  initialPreset,
  onSaved,
}: {
  gateway?: AiGatewayProviderPublic
  presets: AiGatewayPreset[]
  initialPreset: AiGatewayPreset
  onSaved?: () => void
}) {
  const router = useRouter()
  const [state, action, saving] = useActionState(saveAiGatewayAction, initialState)
  const [working, startTransition] = useTransition()
  const [operationMessage, setOperationMessage] = useState<string | null>(null)
  const [operationOk, setOperationOk] = useState(true)
  const [presetKey, setPresetKey] = useState<AiGatewayPresetKey>(gateway?.preset || initialPreset.key)
  const [name, setName] = useState(gateway?.name || initialPreset.label)
  const [baseUrl, setBaseUrl] = useState(gateway?.baseUrl || initialPreset.baseUrl)
  const [chatPath, setChatPath] = useState(gateway?.chatPath || initialPreset.chatPath)
  const [modelsPath, setModelsPath] = useState(gateway?.modelsPath || initialPreset.modelsPath)
  const [authType, setAuthType] = useState<AiGatewayAuthType>(gateway?.authType || initialPreset.authType)
  const [timeout, setTimeoutValue] = useState(gateway?.timeout || initialPreset.timeout)
  const [maxConcurrency, setMaxConcurrency] = useState(gateway?.maxConcurrency || initialPreset.maxConcurrency)
  const [priority, setPriority] = useState(gateway?.priority || 1)
  const [enabled, setEnabled] = useState(gateway?.enabled ?? true)
  const manualModels = gateway?.models
    .filter(model => model.source === "manual")
    .map(model => model.id)
    .join("\n") || ""
  const modelCounts = useMemo(() => {
    const counts = { gpt: 0, claude: 0, gemini: 0, other: 0 }
    for (const model of gateway?.models || []) counts[model.family] += 1
    return counts
  }, [gateway?.models])
  const visibleState = !gateway || !state.id || state.id === gateway.id

  useEffect(() => {
    if (!state.ok || gateway || !onSaved) return
    onSaved()
    router.refresh()
  }, [gateway, onSaved, router, state.ok])

  function applyPreset(nextKey: AiGatewayPresetKey) {
    const preset = presets.find(item => item.key === nextKey)
    setPresetKey(nextKey)
    if (!preset) return
    if (!gateway) setName(preset.label)
    setBaseUrl(preset.baseUrl)
    setChatPath(preset.chatPath)
    setModelsPath(preset.modelsPath)
    setAuthType(preset.authType)
    setTimeoutValue(preset.timeout)
    setMaxConcurrency(preset.maxConcurrency)
  }

  function runSync() {
    if (!gateway) return
    setOperationMessage(null)
    startTransition(async () => {
      const result = await syncAiGatewayModelsAction(gateway.id)
      setOperationOk(result.ok)
      setOperationMessage(result.ok ? result.message : result.error)
      router.refresh()
    })
  }

  function runToggle() {
    if (!gateway) return
    setOperationMessage(null)
    startTransition(async () => {
      const result = await toggleAiGatewayAction(gateway.id, !gateway.enabled)
      setOperationOk(result.ok)
      setOperationMessage(result.ok ? result.message : result.error)
      router.refresh()
    })
  }

  function runModelToggle(modelId: string, nextEnabled: boolean) {
    if (!gateway) return
    setOperationMessage(null)
    startTransition(async () => {
      const result = await toggleAiGatewayModelAction(gateway.id, modelId, nextEnabled)
      setOperationOk(result.ok)
      setOperationMessage(result.ok ? result.message : result.error)
      router.refresh()
    })
  }

  return (
    <form action={action} className="p-4 sm:p-5">
      <input type="hidden" name="id" value={gateway?.id || ""} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">
              {gateway?.name || "新中转站"}
            </span>
            {gateway && <HealthBadge gateway={gateway} />}
            {gateway && (
              <span className={gateway.enabled
                ? "rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                : "rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500"}
              >
                {gateway.enabled ? "已启用" : "已停用"}
              </span>
            )}
          </div>
          {gateway?.lastCheckedAt && (
            <p className="mt-1 text-[11px] text-slate-400">
              最近检测 {new Date(gateway.lastCheckedAt).toLocaleString("zh-CN", { hour12: false })}
              {typeof gateway.lastLatencyMs === "number" ? ` · ${gateway.lastLatencyMs}ms` : ""}
            </p>
          )}
        </div>
        {gateway && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={runSync}
              disabled={working}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-3 text-xs font-medium text-cyan-800 transition hover:bg-cyan-100 disabled:opacity-60"
            >
              {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              测试并同步模型
            </button>
            <button
              type="button"
              onClick={runToggle}
              disabled={working}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <Power className="h-3.5 w-3.5" />
              {gateway.enabled ? "停用" : "启用"}
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="服务预设">
          <select
            name="preset"
            value={presetKey}
            onChange={event => applyPreset(event.target.value as AiGatewayPresetKey)}
            className={inputClass}
          >
            {presets.map(preset => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
          </select>
        </Field>
        <Field label="中转站名称">
          <input name="name" value={name} onChange={event => setName(event.target.value)} className={inputClass} />
        </Field>
        <Field label="API Key">
          <input
            name="apiKey"
            type="password"
            autoComplete="off"
            placeholder={gateway?.hasApiKey ? `留空保留 ${gateway.apiKeyPreview}` : "粘贴 API Key"}
            className={inputClass}
          />
        </Field>
        <Field label="鉴权方式">
          <select name="authType" value={authType} onChange={event => setAuthType(event.target.value as AiGatewayAuthType)} className={inputClass}>
            <option value="bearer">Bearer Token</option>
            <option value="x-api-key">x-api-key</option>
          </select>
        </Field>
        <Field label="接口根地址">
          <input name="baseUrl" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} className={inputClass} />
        </Field>
        <Field label="Chat Path">
          <input name="chatPath" value={chatPath} onChange={event => setChatPath(event.target.value)} className={inputClass} />
        </Field>
        <Field label="Models Path">
          <input name="modelsPath" value={modelsPath} onChange={event => setModelsPath(event.target.value)} className={inputClass} />
        </Field>
        <Field label="优先级">
          <input name="priority" type="number" min={1} max={999} value={priority} onChange={event => setPriority(Number(event.target.value))} className={inputClass} />
        </Field>
        <Field label="超时（秒）">
          <input name="timeout" type="number" min={30} max={1800} step={30} value={timeout} onChange={event => setTimeoutValue(Number(event.target.value))} className={inputClass} />
        </Field>
        <Field label="最大并发">
          <input name="maxConcurrency" type="number" min={1} max={20} value={maxConcurrency} onChange={event => setMaxConcurrency(Number(event.target.value))} className={inputClass} />
        </Field>
        <label className="text-xs md:col-span-2">
          <span className="mb-1.5 block font-medium text-slate-500">手动模型名（每行一个）</span>
          <textarea
            name="manualModels"
            defaultValue={manualModels}
            rows={3}
            placeholder="模型接口不支持 /v1/models 时，可在这里填写"
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-blue-100"
          />
        </label>
      </div>

      {gateway && gateway.models.length > 0 && (
        <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-600">
            已开放 {gateway.models.filter(model => model.enabled).length} 个模型
            <span className="ml-2 font-normal text-slate-400">
              GPT {modelCounts.gpt} · Claude {modelCounts.claude} · Gemini {modelCounts.gemini} · 其他 {modelCounts.other}
            </span>
          </summary>
          <div className="mt-2 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
            {gateway.models.map(model => (
              <button
                key={model.id}
                type="button"
                disabled={working}
                title={model.enabled ? "点击后不再向用户开放" : "点击后向用户开放"}
                onClick={() => runModelToggle(model.id, !model.enabled)}
                className={model.enabled
                  ? "rounded-md bg-white px-2 py-1 text-[10px] text-slate-700 ring-1 ring-emerald-200 transition hover:bg-emerald-50"
                  : "rounded-md bg-slate-100 px-2 py-1 text-[10px] text-slate-400 line-through ring-1 ring-slate-200 transition hover:bg-white"}
              >
                {model.id}
              </button>
            ))}
          </div>
        </details>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-slate-600">
          <input name="enabled" type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} className="accent-[#1677FF]" />
          保存后启用
        </label>
        {gateway && (
          <label className="inline-flex items-center gap-2 text-xs text-slate-500">
            <input name="clearApiKey" type="checkbox" className="accent-rose-600" />
            清除旧 Key
          </label>
        )}
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#1677FF] px-4 text-xs font-semibold text-white transition hover:bg-[#0958D9] disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? "保存中..." : gateway ? "保存中转站" : "添加中转站"}
        </button>
        {visibleState && state.message && (
          <span className={state.ok ? "text-xs text-emerald-600" : "text-xs text-rose-600"}>{state.message}</span>
        )}
        {operationMessage && (
          <span className={operationOk ? "text-xs text-emerald-600" : "text-xs text-rose-600"}>{operationMessage}</span>
        )}
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="text-xs">
      <span className="mb-1.5 block font-medium text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function HealthBadge({ gateway }: { gateway: AiGatewayProviderPublic }) {
  if (gateway.healthStatus === "healthy") {
    return (
      <span title={gateway.healthMessage} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        连接正常
      </span>
    )
  }
  if (gateway.healthStatus === "unhealthy") {
    return (
      <span title={gateway.healthMessage} className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">
        <XCircle className="h-3 w-3" />
        连接异常
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
      <KeyRound className="h-3 w-3" />
      待检测
    </span>
  )
}
