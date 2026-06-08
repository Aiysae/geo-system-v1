"use client"

import { useActionState, useState } from "react"
import { KeyRound, Save } from "lucide-react"
import { saveAiSettingAction, type SaveAiSettingState } from "./actions"
import type { AiProviderPreset, AiProviderPublicSetting } from "@/types/ai-settings"

const initialState: SaveAiSettingState = {}

export function AiSettingsManager({ settings }: { settings: AiProviderPublicSetting[] }) {
  return (
    <section className="mt-8 rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#006AA3] ring-1 ring-blue-100">
            <KeyRound className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">AI 模型 API 配置</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              统一管理整个系统调用的大模型 Key、模型名和接口地址。前台页面不会再展示或保存 API Key。
            </p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {settings.map(setting => (
          <AiSettingForm key={setting.key} setting={setting} />
        ))}
      </div>
    </section>
  )
}

function AiSettingForm({ setting }: { setting: AiProviderPublicSetting }) {
  const [state, action, pending] = useActionState(saveAiSettingAction, initialState)
  const isCurrent = state.key === setting.key
  const [baseUrl, setBaseUrl] = useState(setting.baseUrl)
  const [chatPath, setChatPath] = useState(setting.chatPath)
  const [model, setModel] = useState(setting.model)
  const [timeout, setTimeoutValue] = useState(setting.timeout)
  const [extra, setExtra] = useState<Record<string, string | boolean>>(setting.extra)

  function applyPreset(preset: AiProviderPreset) {
    if (preset.baseUrl !== undefined) setBaseUrl(preset.baseUrl)
    if (preset.chatPath !== undefined) setChatPath(preset.chatPath)
    if (preset.model !== undefined) setModel(preset.model)
    if (preset.timeout !== undefined) setTimeoutValue(preset.timeout)
    if (preset.extra) setExtra(prev => ({ ...prev, ...preset.extra }))
  }

  return (
    <form action={action} className="p-4 sm:p-5">
      <input type="hidden" name="key" value={setting.key} />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div>
          <div className="text-sm font-semibold text-slate-900">{setting.label}</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{setting.description}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className={setting.hasApiKey ? "rounded-lg bg-emerald-50 px-2 py-1 font-medium text-emerald-700 ring-1 ring-emerald-100" : "rounded-lg bg-rose-50 px-2 py-1 font-medium text-rose-700 ring-1 ring-rose-100"}>
              {setting.hasApiKey ? `Key 已配置 ${setting.apiKeyPreview}` : "Key 未配置"}
            </span>
            {setting.updatedAt && (
              <span className="rounded-lg bg-slate-50 px-2 py-1 text-slate-500 ring-1 ring-slate-200">
                {new Date(setting.updatedAt).toLocaleString("zh-CN", { hour12: false })}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {setting.presets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {setting.presets.map(preset => (
                <button
                  key={preset.key}
                  type="button"
                  title={preset.description}
                  onClick={() => applyPreset(preset)}
                  className="rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-[11px] font-medium text-[#006AA3] transition hover:border-[#0077B6] hover:bg-blue-100"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs">
            <span className="mb-1.5 block font-medium text-slate-500">API Key</span>
            <input
              name="apiKey"
              type="password"
              autoComplete="off"
              placeholder={setting.hasApiKey ? "留空保留当前 Key" : "粘贴 API Key"}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-[#0077B6] focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <label className="text-xs">
            <span className="mb-1.5 block font-medium text-slate-500">模型 / Endpoint</span>
            <input
              name="model"
              value={model}
              onChange={event => setModel(event.target.value)}
              placeholder="模型名或 endpoint id"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-[#0077B6] focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <label className="text-xs">
            <span className="mb-1.5 block font-medium text-slate-500">接口根地址</span>
            <input
              name="baseUrl"
              value={baseUrl}
              onChange={event => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-[#0077B6] focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <label className="text-xs">
            <span className="mb-1.5 block font-medium text-slate-500">Chat Path</span>
            <input
              name="chatPath"
              value={chatPath}
              onChange={event => setChatPath(event.target.value)}
              placeholder="/v1/chat/completions"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-[#0077B6] focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <label className="text-xs">
            <span className="mb-1.5 block font-medium text-slate-500">超时（秒）</span>
            <input
              name="timeout"
              type="number"
              min={30}
              max={1800}
              step={30}
              value={timeout}
              onChange={event => setTimeoutValue(Number(event.target.value))}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-[#0077B6] focus:ring-2 focus:ring-blue-100"
            />
          </label>

          {setting.extraFields.map(field => (
            <label key={field.key} className="text-xs">
              <span className="mb-1.5 block font-medium text-slate-500">{field.label}</span>
              {field.inputType === "checkbox" ? (
                <span className="flex h-10 items-center rounded-lg border border-slate-200 bg-white px-3">
                  <input
                    name={`extra.${field.key}`}
                    type="checkbox"
                    checked={extra[field.key] === true}
                    onChange={event => setExtra(prev => ({ ...prev, [field.key]: event.target.checked }))}
                    className="accent-[#0077B6]"
                  />
                </span>
              ) : (
                <input
                  name={`extra.${field.key}`}
                  value={typeof extra[field.key] === "string" ? String(extra[field.key]) : ""}
                  onChange={event => setExtra(prev => ({ ...prev, [field.key]: event.target.value }))}
                  placeholder={field.placeholder}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-[#0077B6] focus:ring-2 focus:ring-blue-100"
                />
              )}
            </label>
          ))}

          <label className="flex items-center gap-2 self-end text-xs text-slate-500">
            <input name="clearApiKey" type="checkbox" className="accent-rose-600" />
            清除后台保存的 Key
          </label>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#004B73] to-[#0077B6] px-4 text-xs font-medium text-white transition hover:shadow-md hover:shadow-blue-200/60 disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" />
              {pending ? "保存中..." : "保存配置"}
            </button>
            {isCurrent && state.message && (
              <span className={state.ok ? "text-xs text-emerald-600" : "text-xs text-rose-600"}>
                {state.message}
              </span>
            )}
          </div>
          </div>
        </div>
      </div>
    </form>
  )
}
