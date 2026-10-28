"use client"

import { useMemo, useState } from "react"
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  ImageOff,
  Loader2,
  RefreshCw,
  Save,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { composeVideoFrame } from "@/components/video/video-frame-composer"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { ARTICLE_VIDEO_PLATFORM_OPTIONS } from "@/lib/article-video-script"
import { estimateFeatureCredits } from "@/lib/pricing"
import { VIDEO_PRODUCTION_TYPES, VIDEO_VISUAL_STYLES } from "@/lib/video-production/options"
import type {
  VideoGeneratedImage,
  VideoProductionItem,
  VideoScript,
  VideoScriptSegment,
} from "@/types/video-production"

type SegmentDraft = Pick<VideoScriptSegment, "id" | "voiceover" | "screenText" | "action" | "broll">

type Draft = {
  title: string
  coverTitle: string
  description: string
  tagsText: string
  segments: SegmentDraft[]
}

function draftFrom(script: VideoScript): Draft {
  return {
    title: script.title,
    coverTitle: script.coverTitle,
    description: script.description,
    tagsText: script.tags.join(" "),
    segments: script.segments.map(segment => ({
      id: segment.id,
      voiceover: segment.voiceover,
      screenText: segment.screenText || "",
      action: segment.action || "",
      broll: segment.broll || "",
    })),
  }
}

export function videoAssetUrl(itemId: string, image?: VideoGeneratedImage): string {
  return image?.assetId ? `/api/video-production/${itemId}/assets/${image.assetId}` : ""
}

export function videoTypeLabel(item: VideoProductionItem): string {
  return VIDEO_PRODUCTION_TYPES.find(type => type.value === item.settings.type)?.label || "视频"
}

function scriptText(item: VideoProductionItem, script: VideoScript): string {
  const isSlides = item.settings.type === "slides"
  return [
    `【疑问句】${item.question}`,
    `【类型】${videoTypeLabel(item)}`,
    "",
    "【标题】",
    script.title,
    "",
    "【封面大字】",
    script.coverTitle,
    "",
    "【视频简介】",
    script.description,
    "",
    "【标签】",
    script.tags.join(" "),
    "",
    `【分镜】（约 ${script.estimatedSeconds} 秒）`,
    ...script.segments.flatMap((segment, index) => [
      "",
      `${index + 1}.（${segment.seconds} 秒）${isSlides && segment.screenText ? `大字：${segment.screenText}` : ""}`,
      `口播：${segment.voiceover}`,
      ...(segment.subtitleKeywords.length > 0 ? [`重点词：${segment.subtitleKeywords.join("、")}`] : []),
      ...(!isSlides && segment.action ? [`动作：${segment.action}`] : []),
      ...(!isSlides && segment.broll ? [`插入画面：${segment.broll}`] : []),
    ]),
    "",
    "（本视频含 AI 生成内容，发布时请按平台要求添加 AI 生成标识。）",
  ].join("\n")
}

async function fetchBlob(url: string): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok) throw new Error("图片读取失败，请刷新后重试")
  return response.blob() as Promise<Blob>
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, "").slice(0, 40) || "视频"
}

function ImageSlot({
  url,
  image,
  overlay,
  busy,
  className = "",
}: {
  url: string
  image?: VideoGeneratedImage
  overlay?: React.ReactNode
  busy?: boolean
  className?: string
}) {
  return (
    <div className={`relative aspect-[9/16] overflow-hidden rounded-lg bg-slate-100 ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-[10px] text-slate-400">
          <ImageOff className="h-5 w-5" />
          {image?.error || "暂无图片"}
        </div>
      )}
      {url ? overlay : null}
      {busy ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60">
          <Loader2 className="h-5 w-5 animate-spin text-[#1677FF]" />
        </div>
      ) : null}
    </div>
  )
}

function ImageControls({
  image,
  fallbackPrompt,
  busy,
  disabled,
  onRegenerate,
}: {
  image?: VideoGeneratedImage
  fallbackPrompt: string
  busy: boolean
  disabled: boolean
  onRegenerate: (prompt: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState(image?.prompt || fallbackPrompt)
  const credits = estimateFeatureCredits("videoProductionImage")
  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="flex gap-1">
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => onRegenerate(image?.prompt || fallbackPrompt)}
          title={`按原描述重新生成，消耗 ${credits} 积分`}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white py-1 text-slate-600 transition hover:border-[#91CAFF] hover:text-[#0958D9] disabled:opacity-50"
        >
          <RefreshCw className="h-3 w-3" />
          <span className="text-[10px]">换一张</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(value => !value)}
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-500 transition hover:text-[#0958D9]"
        >
          <span className="text-[10px]">{open ? "收起" : "改描述"}</span>
        </button>
      </div>
      {open ? (
        <div className="space-y-1">
          <Textarea
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            className="min-h-[96px] text-xs leading-5"
          />
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={busy || disabled || !prompt.trim()}
            onClick={() => { onRegenerate(prompt); setOpen(false) }}
          >
            按新描述生成
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export default function VideoProductionEditor({
  item,
  brand,
  readOnly,
  onBack,
  onChange,
}: {
  item: VideoProductionItem
  brand: string
  readOnly: boolean
  onBack: () => void
  onChange: (item: VideoProductionItem) => void
}) {
  const script = item.script as VideoScript
  const [draft, setDraft] = useState<Draft>(() => draftFrom(script))
  const [savedSignature, setSavedSignature] = useState(() => JSON.stringify(draftFrom(script)))
  const [saving, setSaving] = useState(false)
  const [busyImage, setBusyImage] = useState("")
  const [exporting, setExporting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")
  const isSlides = item.settings.type === "slides"
  const dirty = JSON.stringify(draft) !== savedSignature
  const coverUrl = videoAssetUrl(item.id, item.cover)

  const settingsSummary = useMemo(() => [
    videoTypeLabel(item),
    ARTICLE_VIDEO_PLATFORM_OPTIONS.find(option => option.value === item.settings.platform)?.label,
    `约 ${script.estimatedSeconds} 秒`,
    isSlides ? VIDEO_VISUAL_STYLES.find(style => style.value === item.settings.style)?.label : "",
    item.modelLabel,
  ].filter(Boolean).join(" · "), [isSlides, item, script.estimatedSeconds])

  const updateSegment = (id: string, patch: Partial<SegmentDraft>) => {
    setDraft(current => ({
      ...current,
      segments: current.segments.map(segment => segment.id === id ? { ...segment, ...patch } : segment),
    }))
  }

  const save = async (): Promise<VideoProductionItem | null> => {
    setSaving(true)
    setError("")
    try {
      const response = await apiFetch(`/api/video-production/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          coverTitle: draft.coverTitle,
          description: draft.description,
          tags: draft.tagsText.split(/\s+/).filter(Boolean),
          segments: draft.segments,
        }),
      })
      const data = await readApiJson<{ item: VideoProductionItem }>(response, "保存")
      const next = draftFrom(data.item.script as VideoScript)
      setDraft(next)
      setSavedSignature(JSON.stringify(next))
      onChange(data.item)
      return data.item
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败")
      return null
    } finally {
      setSaving(false)
    }
  }

  const regenerate = async (target: string, prompt: string) => {
    setBusyImage(target)
    setError("")
    try {
      const response = await apiFetch(`/api/video-production/${item.id}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, prompt }),
      })
      const data = await readApiJson<{ item: VideoProductionItem }>(response, "重新生成图片")
      if (data.item) onChange(data.item)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重新生成图片失败")
    } finally {
      setBusyImage("")
    }
  }

  const copyText = async () => {
    await navigator.clipboard.writeText(scriptText(item, { ...script, ...draftAsScript(script, draft) }))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const exportPackage = async () => {
    setExporting(true)
    setError("")
    try {
      const current = dirty ? await save() : item
      if (!current?.script) return
      const latest = current.script
      const { default: JSZip } = await import("jszip")
      const zip = new JSZip()
      const folder = zip.folder(safeName(latest.title)) as InstanceType<typeof JSZip>
      folder.file("文案.txt", scriptText(current, latest))
      const coverImageUrl = videoAssetUrl(current.id, current.cover)
      if (coverImageUrl) {
        folder.file("封面.jpg", await composeVideoFrame({ imageUrl: coverImageUrl, kind: "cover", text: latest.coverTitle, brand }))
        folder.file("素材/封面-无字原图.jpg", await fetchBlob(coverImageUrl))
      }
      for (const [index, segment] of latest.segments.entries()) {
        const url = videoAssetUrl(current.id, segment.image)
        if (!url) continue
        const number = String(index + 1).padStart(2, "0")
        folder.file(`画面/${number}.jpg`, await composeVideoFrame({ imageUrl: url, kind: "page", text: segment.screenText || "" }))
        folder.file(`素材/${number}-无字原图.jpg`, await fetchBlob(url))
      }
      const blob = await zip.generateAsync({ type: "blob" })
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = `${safeName(latest.title)}.zip`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "打包下载失败")
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="geo-panel">
      <div className="geo-panel-header flex-wrap">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft />
            返回列表
          </Button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-800">{item.question}</div>
            <div className="mt-0.5 truncate text-[11px] text-slate-500">{settingsSummary}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={copyText}>
            {copied ? <Check /> : <Copy />}
            {copied ? "已复制" : "复制文案"}
          </Button>
          <Button variant="outline" size="sm" onClick={exportPackage} disabled={exporting}>
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            打包下载
          </Button>
          {readOnly ? null : (
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {dirty ? "保存修改" : "已保存"}
            </Button>
          )}
        </div>
      </div>
      {error ? (
        <div className="mx-4 mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
      ) : null}
      <div className="grid gap-5 p-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold text-slate-500">封面预览</div>
          <ImageSlot
            url={coverUrl}
            image={item.cover}
            busy={busyImage === "cover"}
            overlay={(
              <div className="pointer-events-none absolute inset-x-0 top-[11%] bg-gradient-to-b from-black/0 via-black/40 to-black/0 px-3 py-6 text-center">
                <div className="whitespace-pre-line text-[22px] font-extrabold leading-tight text-white [text-shadow:0_2px_8px_rgba(0,0,0,.5)]">
                  {draft.coverTitle}
                </div>
                {brand ? <div className="mt-2 text-[11px] font-semibold text-[#FFD666]">{brand}</div> : null}
              </div>
            )}
          />
          {readOnly ? null : (
            <ImageControls
              key={item.cover?.generatedAt}
              image={item.cover}
              fallbackPrompt={script.coverImageBrief}
              busy={busyImage === "cover"}
              disabled={Boolean(busyImage)}
              onRegenerate={prompt => regenerate("cover", prompt)}
            />
          )}
          <p className="mt-2 text-[10px] leading-4 text-slate-400">
            图片本身不含文字，标题由系统叠加；下载的封面和画面会带“AI 生成”角标。每换一张图消耗 {estimateFeatureCredits("videoProductionImage")} 积分。
          </p>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-slate-500">发布标题</span>
              <Input value={draft.title} disabled={readOnly} onChange={event => setDraft({ ...draft, title: event.target.value })} />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-slate-500">封面大字（回车换行）</span>
              <Textarea
                value={draft.coverTitle}
                disabled={readOnly}
                onChange={event => setDraft({ ...draft, coverTitle: event.target.value })}
                className="min-h-10 py-2"
                rows={2}
              />
            </label>
          </div>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-slate-500">视频简介（AI 搜索最常引用这一段）</span>
            <Textarea
              value={draft.description}
              disabled={readOnly}
              onChange={event => setDraft({ ...draft, description: event.target.value })}
              className="min-h-[96px]"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-slate-500">话题标签（空格分隔）</span>
            <Input value={draft.tagsText} disabled={readOnly} onChange={event => setDraft({ ...draft, tagsText: event.target.value })} />
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                {isSlides ? `分页画面（${script.segments.length} 页）` : `口播分段（${script.segments.length} 段）`}
              </span>
              {script.perspective ? (
                <span className="text-[11px] text-slate-400">专业视角：{script.perspective}</span>
              ) : null}
            </div>
            <div className="space-y-3">
              {script.segments.map((segment, index) => {
                const segmentDraft = draft.segments.find(entry => entry.id === segment.id) as SegmentDraft
                return (
                  <div
                    key={segment.id}
                    className={`grid gap-3 rounded-lg border border-slate-200 bg-slate-50/40 p-3 ${isSlides ? "sm:grid-cols-[120px_minmax(0,1fr)]" : ""}`}
                  >
                    {isSlides ? (
                      <div>
                        <ImageSlot
                          url={videoAssetUrl(item.id, segment.image)}
                          image={segment.image}
                          busy={busyImage === segment.id}
                          overlay={segmentDraft.screenText ? (
                            <div className="pointer-events-none absolute inset-x-0 top-[24%] bg-black/35 px-1.5 py-2 text-center text-[12px] font-extrabold leading-tight text-white">
                              {segmentDraft.screenText}
                            </div>
                          ) : null}
                        />
                        {readOnly ? null : (
                          <ImageControls
                            key={segment.image?.generatedAt}
                            image={segment.image}
                            fallbackPrompt={segment.imageBrief || segment.voiceover}
                            busy={busyImage === segment.id}
                            disabled={Boolean(busyImage)}
                            onRegenerate={prompt => regenerate(segment.id, prompt)}
                          />
                        )}
                      </div>
                    ) : null}
                    <div className="min-w-0 space-y-2">
                      <div className="flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="rounded bg-white px-1.5 py-0.5 font-semibold text-slate-700 ring-1 ring-slate-200">
                          {isSlides ? `第 ${index + 1} 页` : `第 ${index + 1} 段`}
                        </span>
                        <span>{segment.seconds} 秒</span>
                        {segment.subtitleKeywords.length > 0 ? (
                          <span className="truncate">重点词：{segment.subtitleKeywords.join("、")}</span>
                        ) : null}
                      </div>
                      {isSlides ? (
                        <Input
                          value={segmentDraft.screenText}
                          disabled={readOnly}
                          placeholder="这一页的大字"
                          onChange={event => updateSegment(segment.id, { screenText: event.target.value })}
                          className="h-9 font-semibold"
                        />
                      ) : null}
                      <Textarea
                        value={segmentDraft.voiceover}
                        disabled={readOnly}
                        onChange={event => updateSegment(segment.id, { voiceover: event.target.value })}
                        className="min-h-[72px]"
                      />
                      {!isSlides ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Input
                            value={segmentDraft.action}
                            disabled={readOnly}
                            placeholder="动作提示"
                            onChange={event => updateSegment(segment.id, { action: event.target.value })}
                            className="h-9 text-xs"
                          />
                          <Input
                            value={segmentDraft.broll}
                            disabled={readOnly}
                            placeholder="插入画面（可空）"
                            onChange={event => updateSegment(segment.id, { broll: event.target.value })}
                            className="h-9 text-xs"
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function draftAsScript(script: VideoScript, draft: Draft): Partial<VideoScript> {
  return {
    title: draft.title,
    coverTitle: draft.coverTitle,
    description: draft.description,
    tags: draft.tagsText.split(/\s+/).filter(Boolean),
    segments: script.segments.map(segment => {
      const edit = draft.segments.find(entry => entry.id === segment.id)
      return edit ? { ...segment, ...edit } : segment
    }),
  }
}
