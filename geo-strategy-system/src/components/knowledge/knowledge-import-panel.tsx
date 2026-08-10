"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  FileArchive,
  FileText,
  History,
  Loader2,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react"
import type {
  ClientKnowledgeBase,
  GeoEvidenceLevel,
  GeoKnowledgeAssetKind,
} from "@/types/geo-methodology"
import type {
  KnowledgeImportCandidate,
  KnowledgeImportRecord,
} from "@/types/knowledge-import"

const ACCEPTED_FILES = ".doc,.docx,.xlsx,.csv,.pdf,.txt,.md,.jpg,.jpeg,.png,.webp"
const PAGE_SIZE = 20

const KIND_OPTIONS: Array<{ value: GeoKnowledgeAssetKind; label: string }> = [
  { value: "identity", label: "主体信息" },
  { value: "product", label: "产品" },
  { value: "service", label: "服务" },
  { value: "advantage", label: "核心优势" },
  { value: "credential", label: "资质认证" },
  { value: "report", label: "报告数据" },
  { value: "case", label: "案例" },
  { value: "quote", label: "人物引述" },
  { value: "pricing", label: "价格成本" },
  { value: "media", label: "媒体资料" },
  { value: "competitor", label: "竞品资料" },
  { value: "boundary", label: "适用边界" },
  { value: "other", label: "其他" },
]

const EVIDENCE_OPTIONS: Array<{ value: GeoEvidenceLevel; label: string }> = [
  { value: "official", label: "官方资料" },
  { value: "primary", label: "一手资料" },
  { value: "verifiedThirdParty", label: "第三方可核验" },
  { value: "ownedRecord", label: "内部记录" },
  { value: "context", label: "背景资料" },
]

type Versions = Record<string, number>
type CandidateFilter = "all" | "selected" | "attention"

function statusLabel(status: KnowledgeImportRecord["status"]): string {
  return {
    queued: "等待处理",
    extracting: "正在提炼",
    review: "等待审核",
    committing: "正在入库",
    completed: "已完成",
    failed: "处理失败",
    cancelled: "已取消",
  }[status]
}

function formatBytes(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))}KB`
  return `${(size / 1024 / 1024).toFixed(1)}MB`
}

function dateLabel(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : value
}

export function KnowledgeImportPanel({
  clientId,
  teamId,
  canEdit,
  onCommitted,
}: {
  clientId: string
  teamId?: string
  canEdit: boolean
  onCommitted: (knowledgeBase: ClientKnowledgeBase, versions: Versions) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [imports, setImports] = useState<KnowledgeImportRecord[]>([])
  const [active, setActive] = useState<KnowledgeImportRecord | null>(null)
  const [uploading, setUploading] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [notice, setNotice] = useState("")
  const [filter, setFilter] = useState<CandidateFilter>("all")
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const query = useMemo(() => {
    const params = new URLSearchParams({ clientId })
    if (teamId) params.set("teamId", teamId)
    return params.toString()
  }, [clientId, teamId])

  const loadHistory = useCallback(async () => {
    const response = await fetch(`/api/knowledge-base/imports?${query}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
    const payload = await response.json().catch(() => ({})) as {
      imports?: KnowledgeImportRecord[]
      error?: string
    }
    if (!response.ok) throw new Error(payload.error || "导入记录读取失败")
    setImports(payload.imports || [])
  }, [query])

  const refreshImport = useCallback(async (id: string) => {
    const response = await fetch(`/api/knowledge-base/imports/${encodeURIComponent(id)}?${query}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
    const payload = await response.json().catch(() => ({})) as {
      import?: KnowledgeImportRecord
      error?: string
    }
    if (!response.ok || !payload.import) throw new Error(payload.error || "导入状态读取失败")
    const nextImport = payload.import
    setActive(current => current?.id === nextImport.id ? nextImport : current)
    setImports(current => [
      nextImport,
      ...current.filter(item => item.id !== nextImport.id),
    ])
    return nextImport
  }, [query])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadHistory().catch(error => setNotice(error instanceof Error ? error.message : "导入记录读取失败"))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadHistory])

  useEffect(() => {
    if (!active || !["queued", "extracting", "committing"].includes(active.status)) return
    let cancelled = false
    const timer = window.setInterval(() => {
      void refreshImport(active.id)
        .then(result => {
          if (!cancelled && ["review", "completed", "failed", "cancelled"].includes(result.status)) {
            window.clearInterval(timer)
          }
        })
        .catch(error => {
          if (!cancelled) setNotice(error instanceof Error ? error.message : "导入状态读取失败")
        })
    }, 1800)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [active, refreshImport])

  const filteredCandidates = useMemo(() => {
    const candidates = active?.candidates || []
    if (filter === "selected") return candidates.filter(candidate => candidate.selected)
    if (filter === "attention") {
      return candidates.filter(candidate => (
        Boolean(candidate.duplicateOf)
        || Boolean(candidate.conflictWith?.length)
        || Boolean(candidate.issues?.length)
      ))
    }
    return candidates
  }, [active?.candidates, filter])
  const selectedCount = active?.candidates.filter(candidate => candidate.selected).length || 0

  function addFiles(nextFiles: File[]) {
    const accepted = nextFiles.filter(file => {
      const extension = `.${file.name.split(".").pop()?.toLowerCase() || ""}`
      return ACCEPTED_FILES.split(",").includes(extension)
    })
    setFiles(current => {
      const merged = [...current]
      for (const file of accepted) {
        if (!merged.some(item => item.name === file.name && item.size === file.size)) merged.push(file)
      }
      return merged.slice(0, 12)
    })
    setNotice(accepted.length < nextFiles.length ? "已忽略不支持的文件格式" : "")
  }

  async function startImport() {
    if (!canEdit || uploading || files.length === 0) return
    setUploading(true)
    setNotice("")
    try {
      const form = new FormData()
      form.set("clientId", clientId)
      if (teamId) form.set("teamId", teamId)
      form.set("requestId", `kimport_${crypto.randomUUID().replace(/-/g, "")}`)
      files.forEach(file => form.append("files", file))
      const response = await fetch("/api/knowledge-base/imports", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      })
      const payload = await response.json().catch(() => ({})) as {
        import?: KnowledgeImportRecord
        error?: string
      }
      if (!response.ok || !payload.import) throw new Error(payload.error || "资料上传失败")
      setActive(payload.import)
      setImports(current => [payload.import as KnowledgeImportRecord, ...current.filter(item => item.id !== payload.import?.id)])
      setFiles([])
      setVisibleCount(PAGE_SIZE)
      setNotice("资料已进入后台提炼，可继续使用系统其他功能")
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "资料上传失败")
    } finally {
      setUploading(false)
    }
  }

  function updateCandidate(id: string, patch: Partial<KnowledgeImportCandidate>) {
    setActive(current => current ? {
      ...current,
      candidates: current.candidates.map(candidate => candidate.id === id
        ? { ...candidate, ...patch }
        : candidate),
    } : current)
  }

  function selectSafeCandidates() {
    setActive(current => current ? {
      ...current,
      candidates: current.candidates.map(candidate => ({
        ...candidate,
        selected: !candidate.duplicateOf
          && !candidate.conflictWith?.length
          && !candidate.issues?.length
          && Boolean(candidate.title && candidate.content),
      })),
    } : current)
  }

  async function commitCandidates() {
    if (!active || committing || selectedCount === 0) return
    setCommitting(true)
    setNotice("")
    try {
      const response = await fetch(
        `/api/knowledge-base/imports/${encodeURIComponent(active.id)}/commit?${query}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidates: active.candidates }),
        },
      )
      const payload = await response.json().catch(() => ({})) as {
        import?: KnowledgeImportRecord
        knowledgeBase?: ClientKnowledgeBase
        versions?: Versions
        addedCount?: number
        skippedCount?: number
        error?: string
      }
      if (!response.ok || !payload.import || !payload.knowledgeBase) {
        throw new Error(payload.error || "资料入库失败")
      }
      setActive(payload.import)
      setImports(current => [payload.import as KnowledgeImportRecord, ...current.filter(item => item.id !== payload.import?.id)])
      onCommitted(payload.knowledgeBase, payload.versions || {})
      setNotice(`已写入 ${payload.addedCount || 0} 条资料${payload.skippedCount ? `，跳过 ${payload.skippedCount} 条重复项` : ""}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "资料入库失败")
    } finally {
      setCommitting(false)
    }
  }

  async function cancelImport() {
    if (!active || !["queued", "extracting"].includes(active.status)) return
    try {
      const response = await fetch(`/api/knowledge-base/imports/${encodeURIComponent(active.id)}?${query}`, {
        method: "PATCH",
        credentials: "same-origin",
      })
      const payload = await response.json().catch(() => ({})) as { import?: KnowledgeImportRecord; error?: string }
      if (!response.ok || !payload.import) throw new Error(payload.error || "取消失败")
      setActive(payload.import)
      setImports(current => [payload.import as KnowledgeImportRecord, ...current.filter(item => item.id !== payload.import?.id)])
      setNotice("本次导入已取消")
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "取消失败")
    }
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-[#D8E7F7] bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><UploadCloud className="h-4 w-4 text-[#1677FF]" />批量导入客户资料</div>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">上传后先提炼为候选事实，经你审核确认才会用于文章生成。</p>
          </div>
          <span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700"><ShieldCheck className="mr-1 inline h-3 w-3" />原文件私有保存</span>
        </div>

        <div
          className="m-4 flex min-h-28 flex-col items-center justify-center border border-dashed border-[#91CAFF] bg-[#F5FAFF] px-5 py-5 text-center transition hover:border-[#1677FF] hover:bg-[#EEF7FF]"
          onDragOver={event => event.preventDefault()}
          onDrop={event => {
            event.preventDefault()
            if (canEdit) addFiles(Array.from(event.dataTransfer.files))
          }}
        >
          <FileArchive className="h-7 w-7 text-[#1677FF]" />
          <div className="mt-2 text-xs font-semibold text-slate-800">Word、Excel、CSV、PDF、文本或图片</div>
          <div className="mt-1 text-[10px] text-slate-400">单个 15MB，单次最多 12 个文件、合计 45MB</div>
          {canEdit ? (
            <button type="button" onClick={() => inputRef.current?.click()} className="mt-3 h-8 rounded-md border border-[#69B1FF] bg-white px-3 text-[11px] font-semibold text-[#0958D9] hover:bg-blue-50">选择文件</button>
          ) : null}
          <input ref={inputRef} type="file" multiple accept={ACCEPTED_FILES} className="hidden" onChange={event => addFiles(Array.from(event.target.files || []))} />
        </div>

        {files.length > 0 ? (
          <div className="mx-4 mb-4 border-t border-slate-100 pt-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {files.map(file => (
                <div key={`${file.name}:${file.size}`} className="flex min-w-0 items-center gap-2 rounded-md bg-slate-50 px-3 py-2">
                  <FileText className="h-4 w-4 shrink-0 text-[#1677FF]" />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-700">{file.name}</span>
                  <span className="text-[10px] text-slate-400">{formatBytes(file.size)}</span>
                  <button type="button" onClick={() => setFiles(current => current.filter(item => item !== file))} className="text-slate-400 hover:text-rose-600" aria-label={`移除${file.name}`}><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <button type="button" disabled={uploading} onClick={() => void startImport()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white disabled:opacity-50">{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}上传并提炼</button>
            </div>
          </div>
        ) : null}
      </section>

      {active ? (
        <section className="overflow-hidden rounded-lg border border-[#D8E7F7] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <div className="text-sm font-bold text-slate-900">{active.stage}</div>
              <div className="mt-1 text-[10px] text-slate-400">{active.files.map(file => file.name).join("、")}</div>
            </div>
            <span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${active.status === "completed" ? "bg-emerald-50 text-emerald-700" : active.status === "failed" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-[#0958D9]"}`}>{statusLabel(active.status)}</span>
          </div>

          {["queued", "extracting", "committing"].includes(active.status) ? (
            <div className="px-4 py-5">
              <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-[#1677FF] via-[#00AEEA] to-[#00C2A8] transition-all" style={{ width: `${Math.max(8, active.progressPercent)}%` }} /></div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500"><span>任务在后台执行，切换模块不会中断</span><span>{active.progressPercent}%</span></div>
              {canEdit && active.status !== "committing" ? <button type="button" onClick={() => void cancelImport()} className="mt-3 text-[11px] font-semibold text-rose-600 hover:text-rose-700">取消本次导入</button> : null}
            </div>
          ) : null}

          {["review", "completed"].includes(active.status) ? (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 bg-[#F7FBFF] px-4 py-3">
                <div className="flex items-center gap-2">
                  {(["all", "selected", "attention"] as CandidateFilter[]).map(value => (
                    <button key={value} type="button" onClick={() => { setFilter(value); setVisibleCount(PAGE_SIZE) }} className={`h-8 rounded-md px-3 text-[11px] font-semibold ${filter === value ? "bg-[#1677FF] text-white" : "bg-white text-slate-500 ring-1 ring-slate-200"}`}>{value === "all" ? `全部 ${active.candidates.length}` : value === "selected" ? `已选 ${selectedCount}` : `需关注 ${active.candidates.filter(item => item.duplicateOf || item.conflictWith?.length || item.issues?.length).length}`}</button>
                  ))}
                </div>
                {canEdit && active.status === "review" ? <button type="button" onClick={selectSafeCandidates} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#91CAFF] bg-white px-3 text-[11px] font-semibold text-[#0958D9]"><Check className="h-3.5 w-3.5" />选择无冲突资料</button> : null}
              </div>

              <div className="divide-y divide-slate-100">
                {filteredCandidates.slice(0, visibleCount).map(candidate => (
                  <CandidateEditor
                    key={candidate.id}
                    candidate={candidate}
                    canEdit={canEdit && active.status === "review"}
                    query={query}
                    importId={active.id}
                    fileId={active.files.find(file => file.name === candidate.sourceFileName)?.id}
                    onChange={patch => updateCandidate(candidate.id, patch)}
                  />
                ))}
                {filteredCandidates.length === 0 ? <div className="px-4 py-10 text-center text-xs text-slate-400">当前筛选下没有候选资料</div> : null}
              </div>
              {visibleCount < filteredCandidates.length ? <button type="button" onClick={() => setVisibleCount(count => count + PAGE_SIZE)} className="flex h-11 w-full items-center justify-center gap-1 border-t border-slate-100 text-[11px] font-semibold text-[#0958D9] hover:bg-blue-50"><ChevronDown className="h-4 w-4" />再显示 {Math.min(PAGE_SIZE, filteredCandidates.length - visibleCount)} 条</button> : null}
              {canEdit && active.status === "review" ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-3">
                  <div className="text-[11px] text-slate-500">已选 <strong className="text-slate-900">{selectedCount}</strong> 条；有冲突的资料勾选后会替换同主题旧版本。</div>
                  <button type="button" disabled={committing || selectedCount === 0} onClick={() => void commitCandidates()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#1677FF] px-4 text-xs font-semibold text-white disabled:opacity-40">{committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}审核通过并入库</button>
                </div>
              ) : null}
            </div>
          ) : null}

          {active.status === "completed" ? <div className="flex items-center gap-3 px-4 py-5 text-xs text-emerald-700"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50"><Check className="h-4 w-4" /></span>本批次已审核入库 {active.approvedCount} 条，可在“资料概览”中继续维护。</div> : null}
          {active.status === "failed" || active.status === "cancelled" ? <div className="flex items-start gap-3 px-4 py-5 text-xs text-rose-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><div>{active.error || active.stage}</div>{canEdit ? <button type="button" onClick={() => { setActive(null); inputRef.current?.click() }} className="mt-2 inline-flex items-center gap-1 font-semibold text-[#0958D9]"><RotateCcw className="h-3.5 w-3.5" />重新选择文件</button> : null}</div></div> : null}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-[#D8E7F7] bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3"><History className="h-4 w-4 text-[#1677FF]" /><h3 className="text-sm font-bold text-slate-900">导入记录</h3></div>
        {imports.length === 0 ? <div className="px-4 py-8 text-center text-xs text-slate-400">还没有资料导入记录</div> : (
          <div className="divide-y divide-slate-100">
            {imports.slice(0, 12).map(item => (
              <button key={item.id} type="button" onClick={() => { setActive(item); setFilter("all"); setVisibleCount(PAGE_SIZE); if (["queued", "extracting"].includes(item.status)) void refreshImport(item.id) }} className={`grid w-full gap-2 px-4 py-3 text-left transition hover:bg-blue-50/60 sm:grid-cols-[minmax(0,1fr)_100px_100px] sm:items-center ${active?.id === item.id ? "bg-blue-50/70" : ""}`}>
                <span className="min-w-0"><span className="block truncate text-[11px] font-semibold text-slate-700">{item.files.map(file => file.name).join("、")}</span><span className="mt-0.5 block text-[10px] text-slate-400">{dateLabel(item.createdAt)} · {item.files.length} 个文件</span></span>
                <span className="text-[10px] text-slate-500">{item.candidates.length} 条候选</span>
                <span className="text-[10px] font-semibold text-[#0958D9]">{statusLabel(item.status)}</span>
              </button>
            ))}
          </div>
        )}
      </section>
      <p className={`min-h-4 text-[11px] ${/失败|错误|超过|不存在/.test(notice) ? "text-rose-600" : "text-slate-500"}`} role="status">{notice}</p>
    </div>
  )
}

function CandidateEditor({
  candidate,
  canEdit,
  query,
  importId,
  fileId,
  onChange,
}: {
  candidate: KnowledgeImportCandidate
  canEdit: boolean
  query: string
  importId: string
  fileId?: string
  onChange: (patch: Partial<KnowledgeImportCandidate>) => void
}) {
  const attention = Boolean(candidate.duplicateOf || candidate.conflictWith?.length || candidate.issues?.length)
  return (
    <div className={`grid gap-3 px-4 py-4 sm:grid-cols-[24px_minmax(0,1fr)] ${candidate.selected ? "bg-[#FBFDFF]" : ""}`}>
      <input type="checkbox" checked={candidate.selected} disabled={!canEdit} onChange={event => onChange({ selected: event.target.checked })} className="mt-1 h-4 w-4 accent-[#1677FF]" aria-label={`选择${candidate.title}`} />
      <div className="min-w-0">
        <div className="grid gap-2 sm:grid-cols-[150px_170px_minmax(0,1fr)]">
          <select value={candidate.kind} disabled={!canEdit} onChange={event => onChange({ kind: event.target.value as GeoKnowledgeAssetKind })} className="kb-input">{KIND_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <select value={candidate.evidenceLevel} disabled={!canEdit} onChange={event => onChange({ evidenceLevel: event.target.value as GeoEvidenceLevel })} className="kb-input">{EVIDENCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <input value={candidate.title} disabled={!canEdit} onChange={event => onChange({ title: event.target.value })} className="kb-input font-semibold" aria-label="候选资料标题" />
        </div>
        <textarea value={candidate.content} disabled={!canEdit} onChange={event => onChange({ content: event.target.value })} className="kb-input mt-2 min-h-24 resize-y" aria-label="候选资料内容" />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
          {candidate.sourceFileName ? <span className="inline-flex items-center gap-1 text-slate-500"><FileText className="h-3 w-3" />{candidate.sourceFileName}{candidate.sourceLocator ? ` · ${candidate.sourceLocator}` : ""}</span> : null}
          {attention ? <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-1 font-semibold text-amber-700"><AlertTriangle className="h-3 w-3" />需要人工确认</span> : null}
          {candidate.duplicateOf ? <span className="text-slate-500">与已有资料重复</span> : null}
          {candidate.conflictWith?.length ? <span className="text-amber-700">与 {candidate.conflictWith.length} 条旧资料冲突</span> : null}
          {candidate.issues?.map(issue => <span key={issue} className="text-rose-600">{issue}</span>)}
          {fileId ? <a href={`/api/knowledge-base/imports/${encodeURIComponent(importId)}/files/${encodeURIComponent(fileId)}?${query}`} className="ml-auto inline-flex items-center gap-1 font-semibold text-[#0958D9] hover:text-[#1677FF]"><Download className="h-3 w-3" />下载原文件</a> : null}
        </div>
      </div>
    </div>
  )
}
