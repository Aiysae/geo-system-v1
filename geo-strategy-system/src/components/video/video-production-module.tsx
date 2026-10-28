"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import {
  AlertCircle,
  Clapperboard,
  Loader2,
  Search,
  Square,
  Trash2,
  WandSparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { videoAssetUrl, videoTypeLabel } from "@/components/video/video-production-editor"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { ARTICLE_VIDEO_PLATFORM_OPTIONS } from "@/lib/article-video-script"
import { createBackgroundRequestId } from "@/lib/background-job-client"
import { estimateFeatureCredits } from "@/lib/pricing"
import {
  DEFAULT_VIDEO_PRODUCTION_SETTINGS,
  VIDEO_IMAGE_MODELS,
  VIDEO_PRODUCTION_TYPES,
  VIDEO_VISUAL_STYLES,
} from "@/lib/video-production/options"
import type { Client } from "@/types"
import type {
  VideoProductionItem,
  VideoProductionSettings,
  VideoProductionStatus,
} from "@/types/video-production"

const VideoProductionEditor = dynamic(() => import("@/components/video/video-production-editor"), {
  loading: () => (
    <div className="flex min-h-[420px] items-center justify-center text-sm text-slate-400">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      正在打开
    </div>
  ),
})

const MAX_SELECTION = 50
const POLL_INTERVAL_MS = 4_000

type QuestionOption = { key: string; question: string; advantage: string; category?: string }

const STATUS_LABELS: Record<VideoProductionStatus, { label: string; className: string }> = {
  queued: { label: "排队中", className: "bg-slate-100 text-slate-600" },
  running: { label: "生成中", className: "bg-blue-50 text-[#0958D9]" },
  succeeded: { label: "已完成", className: "bg-emerald-50 text-emerald-700" },
  failed: { label: "失败", className: "bg-red-50 text-red-600" },
  cancelled: { label: "已停止", className: "bg-slate-100 text-slate-500" },
}

function featureKeyFor(settings: VideoProductionSettings) {
  return settings.type === "avatar" ? "videoProductionAvatar" : "videoProductionSlides"
}

function formatTime(value: string): string {
  const date = new Date(value)
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

export default function VideoProductionModule({
  client,
  teamId,
  readOnly = false,
}: {
  client: Client
  teamId?: string
  readOnly?: boolean
}) {
  const brand = client.ourBrand || client.name
  const [settings, setSettings] = useState<VideoProductionSettings>(DEFAULT_VIDEO_PRODUCTION_SETTINGS)
  const questionOptions = useMemo<QuestionOption[]>(() => (
    (client.keywordStrategy?.questions || []).map(question => ({
      key: question.id,
      question: question.question,
      advantage: question.matched_advantage || "",
      category: question.category,
    }))
  ), [client.keywordStrategy?.questions])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [manualText, setManualText] = useState("")
  const [items, setItems] = useState<VideoProductionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [openItemId, setOpenItemId] = useState("")

  const query = useMemo(() => {
    const params = new URLSearchParams({ clientId: client.id })
    if (teamId) params.set("teamId", teamId)
    return params.toString()
  }, [client.id, teamId])

  const load = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/video-production?${query}`)
      const data = await readApiJson<{ items: VideoProductionItem[] }>(response, "读取视频任务")
      setItems(data.items)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取视频任务失败")
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const hasActive = items.some(item => item.status === "queued" || item.status === "running")
  useEffect(() => {
    if (!hasActive) return
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [hasActive, load])

  const manualQuestions = useMemo(() => (
    Array.from(new Set(manualText.split(/\n+/).map(line => line.trim()).filter(Boolean)))
  ), [manualText])
  const chosen = useMemo(() => [
    ...questionOptions.filter(option => selected.has(option.key)).map(option => ({
      question: option.question,
      advantage: option.advantage,
    })),
    ...manualQuestions.map(question => ({ question, advantage: "" })),
  ], [manualQuestions, questionOptions, selected])
  const visibleOptions = useMemo(() => {
    const keyword = search.trim()
    return keyword ? questionOptions.filter(option => option.question.includes(keyword)) : questionOptions
  }, [questionOptions, search])
  const unitCredits = estimateFeatureCredits(featureKeyFor(settings))
  const tooMany = chosen.length > MAX_SELECTION

  const toggle = (key: string) => {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const start = async () => {
    setSubmitting(true)
    setError("")
    setNotice("")
    try {
      const response = await apiFetch("/api/video-production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          teamId,
          requestId: createBackgroundRequestId("video"),
          settings,
          questions: chosen,
        }),
      })
      const data = await readApiJson<{ items: VideoProductionItem[] }>(response, "创建视频任务")
      setNotice(`已提交 ${data.items.length} 条视频，后台生成中，可以离开本页。`)
      setSelected(new Set())
      setManualText("")
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建视频任务失败")
    } finally {
      setSubmitting(false)
    }
  }

  const removeOrStop = async (item: VideoProductionItem) => {
    const active = item.status === "queued" || item.status === "running"
    if (!active && !window.confirm("删除后不可恢复，确定删除这条视频吗？")) return
    try {
      const response = await apiFetch(`/api/video-production/${item.id}`, { method: "DELETE" })
      await readApiJson(response, active ? "停止任务" : "删除")
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败")
    }
  }

  const openItem = items.find(item => item.id === openItemId && item.script)
  if (openItem) {
    return (
      <VideoProductionEditor
        key={openItem.id}
        item={openItem}
        brand={brand}
        readOnly={readOnly}
        onBack={() => setOpenItemId("")}
        onChange={next => setItems(current => current.map(item => item.id === next.id ? next : item))}
      />
    )
  }

  const update = <K extends keyof VideoProductionSettings>(key: K, value: VideoProductionSettings[K]) => {
    setSettings(current => ({ ...current, [key]: value }))
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.2fr)]">
      <section className="geo-panel p-3 sm:p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-700">
          <WandSparkles className="h-3.5 w-3.5 text-[#1677FF]" />
          生成设置
        </div>
        <div className="geo-segmented mb-2 grid-cols-2">
          {VIDEO_PRODUCTION_TYPES.map(type => (
            <button
              key={type.value}
              type="button"
              onClick={() => update("type", type.value)}
              className={`h-9 rounded-lg transition ${
                settings.type === type.value ? "bg-white text-[#003EB3] shadow-sm" : "text-slate-500 hover:bg-white/70"
              }`}
            >
              <span className="text-xs font-semibold">{type.label}</span>
            </button>
          ))}
        </div>
        <p className="mb-3 text-[11px] leading-5 text-slate-500">
          {VIDEO_PRODUCTION_TYPES.find(type => type.value === settings.type)?.description}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs">
            <span className="mb-1.5 block font-medium text-slate-500">发布平台</span>
            <Select value={settings.platform} onChange={event => update("platform", event.target.value as VideoProductionSettings["platform"])}>
              {ARTICLE_VIDEO_PLATFORM_OPTIONS.filter(option => option.value !== "other").map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </label>
          <label className="text-xs">
            <span className="mb-1.5 block font-medium text-slate-500">目标时长</span>
            <Select value={settings.targetSeconds} onChange={event => update("targetSeconds", Number(event.target.value))}>
              {[30, 45, 60, 90, 120].map(seconds => <option key={seconds} value={seconds}>约 {seconds} 秒</option>)}
            </Select>
          </label>
          <label className="text-xs">
            <span className="mb-1.5 block font-medium text-slate-500">画面风格</span>
            <Select value={settings.style} onChange={event => update("style", event.target.value as VideoProductionSettings["style"])}>
              {VIDEO_VISUAL_STYLES.map(style => <option key={style.value} value={style.value}>{style.label}</option>)}
            </Select>
          </label>
          <label className="text-xs">
            <span className="mb-1.5 block font-medium text-slate-500">生图模型</span>
            <Select value={settings.imageModel} onChange={event => update("imageModel", event.target.value as VideoProductionSettings["imageModel"])}>
              {VIDEO_IMAGE_MODELS.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}
            </Select>
          </label>
          <label className="text-xs">
            <span className="mb-1.5 block font-medium text-slate-500">话题标签数</span>
            <Select value={settings.tagCount} onChange={event => update("tagCount", Number(event.target.value))}>
              {[5, 8, 10, 15].map(count => <option key={count} value={count}>{count} 个</option>)}
            </Select>
          </label>
        </div>
        <label className="mt-3 block text-xs">
          <span className="mb-1.5 block font-medium text-slate-500">补充要求（可空）</span>
          <Textarea
            value={settings.extraRequirements}
            onChange={event => update("extraRequirements", event.target.value)}
            placeholder="例如：口吻轻松一点；结尾引导到官网；不要提价格"
            className="min-h-[64px]"
          />
        </label>

        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">选择疑问句</span>
            {questionOptions.length > 0 ? (
              <span className="flex gap-2 text-[11px]">
                <button type="button" className="text-[#0958D9] hover:underline" onClick={() => setSelected(new Set(visibleOptions.slice(0, MAX_SELECTION).map(option => option.key)))}>
                  <span className="text-[11px]">全选{search ? "筛选结果" : ""}</span>
                </button>
                <button type="button" className="text-slate-500 hover:underline" onClick={() => setSelected(new Set())}>
                  <span className="text-[11px]">清空</span>
                </button>
              </span>
            ) : null}
          </div>
          {questionOptions.length > 0 ? (
            <>
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="搜索疑问句"
                  className="geo-control h-8 w-full pl-8 pr-2 text-xs"
                />
              </div>
              <div className="max-h-[300px] space-y-1 overflow-y-auto pr-1">
                {visibleOptions.map(option => (
                  <label
                    key={option.key}
                    className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-xs transition ${
                      selected.has(option.key) ? "border-[#91CAFF] bg-[#F0F7FF]" : "border-slate-100 hover:border-slate-200"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(option.key)}
                      onChange={() => toggle(option.key)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block leading-5 text-slate-700">{option.question}</span>
                      {option.advantage ? (
                        <span className="mt-0.5 block truncate text-[10px] text-slate-400">匹配优势：{option.advantage}</span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">
              还没有疑问句池。可以先在“策略规划 → 关键词与策略报告”生成，或在下面手动填写。
            </p>
          )}
          <label className="mt-3 block text-xs">
            <span className="mb-1.5 block font-medium text-slate-500">手动添加疑问句（每行一个）</span>
            <Textarea
              value={manualText}
              onChange={event => setManualText(event.target.value)}
              placeholder={`例如：${client.industry || "定制家具"}怎么选不踩坑？`}
              className="min-h-[64px]"
            />
          </label>
        </div>

        {error ? (
          <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</div>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500">
            已选 {chosen.length} 条{tooMany ? `（单次最多 ${MAX_SELECTION} 条）` : ""} · 每条 {unitCredits} 积分
            {chosen.length > 0 ? `，共 ${chosen.length * unitCredits} 积分` : ""}
          </span>
          <Button onClick={start} disabled={readOnly || submitting || chosen.length === 0 || tooMany}>
            {submitting ? <Loader2 className="animate-spin" /> : <Clapperboard />}
            批量生成
          </Button>
        </div>
      </section>

      <section className="geo-panel">
        <div className="geo-panel-header">
          <div>
            <div className="geo-panel-title">视频列表</div>
            <div className="geo-panel-description">生成完成后点开审改文案、换图，再打包下载导入剪映。</div>
          </div>
          {hasActive ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-[#0958D9]">
              <Loader2 className="h-3 w-3 animate-spin" />
              后台生成中
            </span>
          ) : null}
        </div>
        <div className="p-3 sm:p-4">
          {loading ? (
            <div className="flex min-h-[240px] items-center justify-center text-sm text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在读取
            </div>
          ) : items.length === 0 ? (
            <div className="geo-empty-state flex-col gap-2 text-center text-xs text-slate-400">
              <Clapperboard className="h-6 w-6" />
              还没有视频。在左边选好疑问句，点“批量生成”。
            </div>
          ) : (
            <div className="space-y-2">
              {items.map(item => {
                const status = STATUS_LABELS[item.status]
                const active = item.status === "queued" || item.status === "running"
                const cover = videoAssetUrl(item.id, item.cover)
                return (
                  <div key={item.id} className="flex items-stretch gap-3 rounded-lg border border-slate-200 p-2.5 transition hover:border-[#91CAFF]">
                    <button
                      type="button"
                      disabled={!item.script || item.status !== "succeeded"}
                      onClick={() => setOpenItemId(item.id)}
                      className="flex min-w-0 flex-1 items-stretch gap-3 text-left disabled:cursor-default"
                    >
                      <div className="h-[84px] w-[48px] shrink-0 overflow-hidden rounded-md bg-slate-100">
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cover} alt="" className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${status.className}`}>{status.label}</span>
                          <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">{videoTypeLabel(item)}</span>
                          <span className="text-[10px] text-slate-400">{formatTime(item.createdAt)}</span>
                        </div>
                        <div className="mt-1 truncate text-[13px] font-semibold text-slate-800">
                          {item.script?.title || item.question}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-500">
                          {item.script ? `疑问句：${item.question}` : null}
                        </div>
                        <div className="mt-0.5 text-[11px]">
                          {active ? (
                            <span className="text-[#0958D9]">{item.stage || "等待生成"}</span>
                          ) : item.status === "failed" || item.status === "cancelled" ? (
                            <span className="text-red-500">{item.error}</span>
                          ) : item.script ? (
                            <span className="text-slate-400">
                              {item.script.segments.length} {item.settings.type === "slides" ? "页" : "段"} · 约 {item.script.estimatedSeconds} 秒 · 点开审改
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                    {readOnly ? null : (
                      <button
                        type="button"
                        onClick={() => removeOrStop(item)}
                        title={active ? "停止并退回积分" : "删除"}
                        className="self-start rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-red-500"
                      >
                        {active ? <Square className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
