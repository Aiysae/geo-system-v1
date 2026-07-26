"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  CheckCircle2,
  Database,
  Globe2,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Power,
  TestTube2,
  Trash2,
  XCircle,
} from "lucide-react"
import {
  AI_CREDENTIAL_PRESET_BY_VENDOR,
  AI_CREDENTIAL_VENDOR_PRESETS,
} from "@/lib/ai-credential-presets"
import type {
  AiCredentialHealthStatus,
  AiCredentialPublic,
  AiCredentialVendor,
} from "@/types/ai-credentials"
import {
  deleteCredentialAction,
  saveCredentialAction,
  testCredentialAction,
  testCredentialWebAction,
  toggleCredentialAction,
  type CredentialActionResult,
} from "./credential-actions"

const HEALTH_LABELS: Record<AiCredentialHealthStatus, string> = {
  unchecked: "待检测",
  healthy: "可用",
  degraded: "需复查",
  unhealthy: "不可用",
}

const HEALTH_STYLES: Record<AiCredentialHealthStatus, string> = {
  unchecked: "bg-slate-100 text-slate-600",
  healthy: "bg-emerald-50 text-emerald-700",
  degraded: "bg-amber-50 text-amber-700",
  unhealthy: "bg-rose-50 text-rose-700",
}

function CredentialForm({
  credential,
  onComplete,
}: {
  credential?: AiCredentialPublic
  onComplete: (result: CredentialActionResult) => void
}) {
  const [vendor, setVendor] = useState<AiCredentialVendor>(credential?.vendor || "qwen")
  const [pending, startTransition] = useTransition()
  const preset = AI_CREDENTIAL_PRESET_BY_VENDOR.get(vendor)!

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await saveCredentialAction(formData)
      onComplete(result)
    })
  }

  return (
    <form action={submit} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {credential ? <input type="hidden" name="id" value={credential.id} /> : null}
      <label className="text-xs font-semibold text-slate-600">
        模型供应商
        <select
          name="vendor"
          value={vendor}
          onChange={event => setVendor(event.target.value as AiCredentialVendor)}
          disabled={Boolean(credential)}
          className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-[#1677FF]"
        >
          {AI_CREDENTIAL_VENDOR_PRESETS.map(item => (
            <option key={item.vendor} value={item.vendor}>{item.label}</option>
          ))}
        </select>
      </label>
      <label className="text-xs font-semibold text-slate-600">
        账号名称
        <input
          name="accountLabel"
          required
          defaultValue={credential?.accountLabel || ""}
          placeholder="例如：2号账号"
          className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#1677FF]"
        />
      </label>
      <label className="text-xs font-semibold text-slate-600">
        API Key
        <input
          name="apiKey"
          type="password"
          required={!credential}
          autoComplete="new-password"
          placeholder={credential?.apiKeyPreview || "粘贴 API Key"}
          className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm outline-none focus:border-[#1677FF]"
        />
      </label>
      <label className="text-xs font-semibold text-slate-600">
        可用模型
        <input
          name="allowedModels"
          required
          defaultValue={credential?.allowedModels.join(", ") || preset.defaultModels.join(", ")}
          placeholder="多个模型用逗号分隔"
          className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#1677FF]"
        />
      </label>

      <details className="md:col-span-2 xl:col-span-4 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-slate-600">高级设置</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-medium text-slate-500 xl:col-span-2">
            Base URL
            <input
              name="baseUrl"
              defaultValue={credential?.baseUrl || preset.baseUrl}
              className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-[#1677FF]"
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            Chat Path
            <input
              name="chatPath"
              defaultValue={credential?.chatPath || preset.chatPath}
              className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-[#1677FF]"
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            额度组
            <input
              name="quotaGroup"
              defaultValue={credential?.quotaGroup || ""}
              placeholder="不同账号请使用不同额度组"
              className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-[#1677FF]"
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            最大并发
            <input
              name="maxConcurrency"
              type="number"
              min={1}
              max={50}
              defaultValue={credential?.maxConcurrency || preset.defaultConcurrency}
              className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-[#1677FF]"
            />
          </label>
          <input
            type="hidden"
            name="quotaGroupMaxConcurrency"
            value={credential?.quotaGroupMaxConcurrency || preset.defaultConcurrency}
          />
          <input type="hidden" name="priority" value={credential?.priority || 100} />
          <input type="hidden" name="weight" value={credential?.weight || 100} />
          <label className="text-xs font-medium text-slate-500">
            每分钟请求上限
            <input
              name="rpmLimit"
              type="number"
              min={1}
              defaultValue={credential?.rpmLimit || ""}
              placeholder="留空不限制"
              className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-[#1677FF]"
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            每分钟 Token 上限
            <input
              name="tpmLimit"
              type="number"
              min={1}
              defaultValue={credential?.tpmLimit || ""}
              placeholder="留空不限制"
              className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-[#1677FF]"
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            日预算保护（分）
            <input
              name="dailyBudgetCents"
              type="number"
              min={1}
              defaultValue={credential?.dailyBudgetCents || ""}
              placeholder="留空不限制"
              className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-[#1677FF]"
            />
          </label>
        </div>
      </details>

      <div className="md:col-span-2 xl:col-span-4 flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#1677FF] px-4 text-xs font-semibold text-white transition hover:bg-[#0958D9] disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
          {credential ? "保存并重新检测" : "安全保存"}
        </button>
      </div>
    </form>
  )
}

export function AiCredentialPoolManager({
  credentials,
}: {
  credentials: AiCredentialPublic[]
}) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(credentials.length === 0)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const grouped = useMemo(() => {
    const map = new Map<AiCredentialVendor, AiCredentialPublic[]>()
    for (const credential of credentials) {
      map.set(credential.vendor, [...(map.get(credential.vendor) || []), credential])
    }
    return map
  }, [credentials])

  function complete(result: CredentialActionResult) {
    setNotice(result.ok
      ? { ok: true, text: result.message }
      : { ok: false, text: result.error })
    if (result.ok) {
      setEditingId(null)
      setShowCreate(false)
      router.refresh()
    }
  }

  async function runAction(
    id: string,
    action: () => Promise<CredentialActionResult>,
  ) {
    setWorkingId(id)
    try {
      complete(await action())
    } finally {
      setWorkingId(null)
    }
  }

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00B8D9] text-white">
            <Database className="h-4.5 w-4.5" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900">多账号调度池</h2>
            <p className="mt-0.5 text-xs text-slate-500">新增账号保存后先检测，通过后再启用。</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowCreate(value => !value)
            setEditingId(null)
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#1677FF] px-3.5 text-xs font-semibold text-white hover:bg-[#0958D9]"
        >
          <Plus className="h-3.5 w-3.5" />
          添加账号
        </button>
      </div>

      {notice ? (
        <div className={`mx-5 mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
          notice.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
        }`}>
          {notice.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {notice.text}
        </div>
      ) : null}

      {showCreate ? (
        <div className="border-b border-slate-100 bg-[#F7FBFF] px-5 py-4">
          <CredentialForm onComplete={complete} />
        </div>
      ) : null}

      <div className="divide-y divide-slate-100">
        {credentials.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">尚未添加多账号凭证。</div>
        ) : [...grouped.entries()].map(([vendor, items]) => {
          const preset = AI_CREDENTIAL_PRESET_BY_VENDOR.get(vendor)
          return (
            <div key={vendor} className="px-5 py-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700">{preset?.label || vendor}</h3>
                <span className="text-[11px] text-slate-400">{items.filter(item => item.enabled).length}/{items.length} 已启用</span>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                {items.map(credential => (
                  <div key={credential.id} className="rounded-lg border border-slate-200 bg-slate-50/40 p-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-sm text-slate-900">{credential.accountLabel}</strong>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${HEALTH_STYLES[credential.healthStatus]}`}>
                            {HEALTH_LABELS[credential.healthStatus]}
                          </span>
                          {credential.enabled ? (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-[#1677FF]">调度中</span>
                          ) : null}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                          <span className="font-mono">{credential.apiKeyPreview || "未配置 Key"}</span>
                          <span>{credential.allowedModels.join("、") || "未指定模型"}</span>
                          <span>并发 {credential.maxConcurrency}</span>
                          {credential.lastLatencyMs ? <span>{credential.lastLatencyMs}ms</span> : null}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {credential.verifiedCapabilities.map(capability => (
                            <span key={capability} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                              {capability}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title="检测账号"
                          disabled={workingId === credential.id}
                          onClick={() => runAction(credential.id, () => testCredentialAction(credential.id))}
                          className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-white hover:text-[#1677FF] disabled:opacity-50"
                        >
                          {workingId === credential.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <TestTube2 className="h-4 w-4" />}
                        </button>
                        {credential.declaredCapabilities.includes("native_web")
                        && credential.declaredCapabilities.includes("auditable_sources") ? (
                          <button
                            type="button"
                            title="检测严格联网与可点击信源"
                            disabled={workingId === credential.id}
                            onClick={() => runAction(credential.id, () => testCredentialWebAction(credential.id))}
                            className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-white hover:text-cyan-600 disabled:opacity-50"
                          >
                            <Globe2 className="h-4 w-4" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          title={credential.enabled ? "停用账号" : "启用账号"}
                          disabled={workingId === credential.id}
                          onClick={() => runAction(
                            credential.id,
                            () => toggleCredentialAction(credential.id, !credential.enabled),
                          )}
                          className={`grid h-8 w-8 place-items-center rounded-md hover:bg-white ${
                            credential.enabled ? "text-emerald-600" : "text-slate-500"
                          }`}
                        >
                          <Power className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="编辑账号"
                          onClick={() => {
                            setEditingId(editingId === credential.id ? null : credential.id)
                            setShowCreate(false)
                          }}
                          className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-white hover:text-[#1677FF]"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="删除账号"
                          disabled={workingId === credential.id || credential.enabled}
                          onClick={() => {
                            if (!window.confirm(`确认删除「${credential.accountLabel}」吗？`)) return
                            void runAction(credential.id, () => deleteCredentialAction(credential.id))
                          }}
                          className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-rose-600 disabled:opacity-30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {editingId === credential.id ? (
                      <div className="mt-4 border-t border-slate-200 pt-4">
                        <CredentialForm credential={credential} onComplete={complete} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
