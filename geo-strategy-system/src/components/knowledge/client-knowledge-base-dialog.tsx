"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  BookOpenCheck,
  CheckCircle2,
  Database,
  Link2,
  Loader2,
  PencilLine,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react"
import {
  getKnowledgeBaseHealth,
  normalizeClientKnowledgeBase,
} from "@/lib/client-knowledge-base"
import type {
  ClientKnowledgeBase,
  GeoEvidenceLevel,
  GeoKnowledgeAsset,
  GeoKnowledgeAssetKind,
  GeoKnowledgeAssetStatus,
} from "@/types/geo-methodology"
import type { AnalysisSubjectType } from "@/types"

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

const STATUS_OPTIONS: Array<{ value: GeoKnowledgeAssetStatus; label: string }> = [
  { value: "provided", label: "已提供" },
  { value: "sourceLinked", label: "已关联来源" },
  { value: "reviewed", label: "已复核" },
  { value: "verified", label: "已验证" },
  { value: "pendingReview", label: "待审核" },
  { value: "conflicted", label: "存在冲突" },
  { value: "expired", label: "已过期" },
  { value: "archived", label: "已归档" },
]

type Versions = Record<string, number>

type AssetDraft = {
  kind: GeoKnowledgeAssetKind
  title: string
  content: string
  evidenceLevel: GeoEvidenceLevel
  status: GeoKnowledgeAssetStatus
  sourceUrls: string
  tags: string
}

const EMPTY_ASSET: AssetDraft = {
  kind: "advantage",
  title: "",
  content: "",
  evidenceLevel: "primary",
  status: "provided",
  sourceUrls: "",
  tags: "",
}

function lines(value: string): string[] {
  return [...new Set(value.split(/\r?\n|[,，、；;]/).map(item => item.trim()).filter(Boolean))]
}

function assetDraft(asset: GeoKnowledgeAsset): AssetDraft {
  return {
    kind: asset.kind,
    title: asset.title,
    content: asset.content,
    evidenceLevel: asset.evidenceLevel,
    status: asset.status,
    sourceUrls: asset.sourceUrls.join("\n"),
    tags: asset.tags.join("、"),
  }
}

function generatedAssetId(): string {
  return `asset_manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function ClientKnowledgeBaseDialog({
  clientId,
  clientName,
  subjectType,
  subjectName,
  teamId,
  canEdit,
  onClose,
}: {
  clientId: string
  clientName: string
  subjectType: AnalysisSubjectType
  subjectName: string
  teamId?: string
  canEdit: boolean
  onClose: () => void
}) {
  const [knowledgeBase, setKnowledgeBase] = useState<ClientKnowledgeBase | null>(null)
  const [versions, setVersions] = useState<Versions>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("")
  const [asset, setAsset] = useState<AssetDraft>(EMPTY_ASSET)
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null)

  const query = teamId ? `&teamId=${encodeURIComponent(teamId)}` : ""
  const health = useMemo(() => getKnowledgeBaseHealth(knowledgeBase || undefined), [knowledgeBase])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const response = await fetch(
          `/api/workspace/clients/${encodeURIComponent(clientId)}?sections=knowledgeBase${query}`,
          { cache: "no-store", credentials: "same-origin" },
        )
        const payload = await response.json().catch(() => ({})) as {
          snapshot?: { sections?: { knowledgeBase?: { knowledgeBase?: unknown } }; versions?: Versions }
          error?: string
        }
        if (!response.ok || !payload.snapshot) throw new Error(payload.error || "资料库读取失败")
        if (cancelled) return
        setKnowledgeBase(normalizeClientKnowledgeBase(
          payload.snapshot.sections?.knowledgeBase?.knowledgeBase,
          { subjectType, subjectName },
        ))
        setVersions(payload.snapshot.versions || {})
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "资料库读取失败")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [clientId, query, subjectName, subjectType])

  function patchBase(next: Partial<ClientKnowledgeBase>) {
    setKnowledgeBase(current => current ? { ...current, ...next } : current)
  }

  function commitAsset() {
    if (!knowledgeBase || !asset.title.trim() || !asset.content.trim()) {
      setNotice("请填写资料标题和内容")
      return
    }
    const now = new Date().toISOString()
    const nextAsset: GeoKnowledgeAsset = {
      id: editingAssetId || generatedAssetId(),
      kind: asset.kind,
      title: asset.title.trim(),
      content: asset.content.trim(),
      evidenceLevel: asset.evidenceLevel,
      status: asset.status,
      sourceUrls: lines(asset.sourceUrls).filter(url => /^https?:\/\//i.test(url)),
      tags: lines(asset.tags),
      subjectName: knowledgeBase.subjectName,
      updatedAt: now,
    }
    const assets = editingAssetId
      ? knowledgeBase.assets.map(item => item.id === editingAssetId ? nextAsset : item)
      : [nextAsset, ...knowledgeBase.assets]
    patchBase({ assets, updatedAt: now })
    setAsset(EMPTY_ASSET)
    setEditingAssetId(null)
    setNotice(editingAssetId ? "资料已更新，点击保存同步到云端" : "资料已加入，点击保存同步到云端")
  }

  function editAsset(item: GeoKnowledgeAsset) {
    setAsset(assetDraft(item))
    setEditingAssetId(item.id)
  }

  function removeAsset(id: string) {
    if (!knowledgeBase || !window.confirm("确认从资料库移除这条资料？")) return
    patchBase({
      assets: knowledgeBase.assets.filter(item => item.id !== id),
      updatedAt: new Date().toISOString(),
    })
    if (editingAssetId === id) {
      setEditingAssetId(null)
      setAsset(EMPTY_ASSET)
    }
  }

  async function save() {
    if (!knowledgeBase || !canEdit || saving) return
    setSaving(true)
    setNotice("")
    try {
      const next = normalizeClientKnowledgeBase({
        ...knowledgeBase,
        revision: knowledgeBase.revision + 1,
        updatedAt: new Date().toISOString(),
      }, { subjectType, subjectName })
      const response = await fetch(
        `/api/workspace/clients/${encodeURIComponent(clientId)}${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patch: { knowledgeBase: next }, expectedVersions: versions }),
        },
      )
      const payload = await response.json().catch(() => ({})) as {
        snapshot?: { sections?: { knowledgeBase?: { knowledgeBase?: unknown } }; versions?: Versions }
        error?: string
        code?: string
      }
      if (!response.ok || !payload.snapshot) {
        if (payload.code === "WORKSPACE_CONFLICT") {
          throw new Error("资料已在其他设备更新，请关闭后重新打开，再合并本次内容。")
        }
        throw new Error(payload.error || "资料库保存失败")
      }
      setKnowledgeBase(normalizeClientKnowledgeBase(
        payload.snapshot.sections?.knowledgeBase?.knowledgeBase || next,
        { subjectType, subjectName },
      ))
      setVersions(payload.snapshot.versions || versions)
      setNotice("资料库已同步到云端")
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "资料库保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`${clientName}资料库`}>
      <div className="flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-lg bg-white shadow-2xl sm:h-[88vh] sm:rounded-lg">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-[linear-gradient(110deg,#001D66,#0958D9_56%,#00AEEA)] px-4 py-4 text-white sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25"><Database className="h-4 w-4" /></span>
            <div className="min-w-0"><h2 className="truncate text-sm font-bold">{clientName}资料库</h2><p className="mt-0.5 truncate text-[11px] text-cyan-50/75">文章生成只调用与本次问题匹配且状态有效的资料</p></div>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 transition hover:bg-white/20" aria-label="关闭资料库"><X className="h-4 w-4" /></button>
        </header>

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-[#1677FF]" />正在读取资料库</div>
        ) : !knowledgeBase ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-rose-600">{notice || "资料库读取失败"}</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto bg-[#F5F9FE] p-4 sm:p-5">
            <div className="grid gap-px overflow-hidden rounded-lg border border-[#D8E7F7] bg-[#D8E7F7] sm:grid-cols-4">
              <HealthMetric label="完整度" value={`${health.completion}%`} />
              <HealthMetric label="可用资料" value={`${health.usable} 条`} />
              <HealthMetric label="带来源" value={`${health.sourceLinked} 条`} />
              <HealthMetric label="已复核" value={`${health.verified} 条`} />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
              <section className="rounded-lg border border-[#D8E7F7] bg-white p-4">
                <div className="flex items-center gap-2"><BookOpenCheck className="h-4 w-4 text-[#1677FF]" /><h3 className="text-sm font-bold text-slate-900">主体资料</h3></div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="主体名称"><input value={knowledgeBase.subjectName} disabled={!canEdit} onChange={event => patchBase({ subjectName: event.target.value })} className="kb-input" /></Field>
                  <Field label="别名（每行一个）"><textarea value={knowledgeBase.aliases.join("\n")} disabled={!canEdit} onChange={event => patchBase({ aliases: lines(event.target.value) })} className="kb-input min-h-20 resize-y" /></Field>
                  <Field label="产品"><textarea value={knowledgeBase.products.join("\n")} disabled={!canEdit} onChange={event => patchBase({ products: lines(event.target.value) })} className="kb-input min-h-20 resize-y" /></Field>
                  <Field label="服务"><textarea value={knowledgeBase.services.join("\n")} disabled={!canEdit} onChange={event => patchBase({ services: lines(event.target.value) })} className="kb-input min-h-20 resize-y" /></Field>
                  <Field label="目标受众"><textarea value={knowledgeBase.audiences.join("\n")} disabled={!canEdit} onChange={event => patchBase({ audiences: lines(event.target.value) })} className="kb-input min-h-20 resize-y" /></Field>
                  <Field label="服务地域"><textarea value={knowledgeBase.regions.join("\n")} disabled={!canEdit} onChange={event => patchBase({ regions: lines(event.target.value) })} className="kb-input min-h-20 resize-y" /></Field>
                  <Field label="主体概述" wide><textarea value={knowledgeBase.summary} disabled={!canEdit} onChange={event => patchBase({ summary: event.target.value })} className="kb-input min-h-28 resize-y" /></Field>
                  <Field label="适用边界（每行一个）" wide><textarea value={knowledgeBase.boundaries.join("\n")} disabled={!canEdit} onChange={event => patchBase({ boundaries: lines(event.target.value) })} className="kb-input min-h-24 resize-y" /></Field>
                </div>
              </section>

              <section className="rounded-lg border border-[#D8E7F7] bg-white p-4">
                <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Plus className="h-4 w-4 text-[#1677FF]" /><h3 className="text-sm font-bold text-slate-900">{editingAssetId ? "编辑事实资料" : "新增事实资料"}</h3></div>{editingAssetId ? <button type="button" onClick={() => { setEditingAssetId(null); setAsset(EMPTY_ASSET) }} className="text-[11px] font-semibold text-slate-500 hover:text-[#0958D9]">取消编辑</button> : null}</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="资料类型"><select value={asset.kind} disabled={!canEdit} onChange={event => setAsset(current => ({ ...current, kind: event.target.value as GeoKnowledgeAssetKind }))} className="kb-input">{KIND_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
                  <Field label="审核状态"><select value={asset.status} disabled={!canEdit} onChange={event => setAsset(current => ({ ...current, status: event.target.value as GeoKnowledgeAssetStatus }))} className="kb-input">{STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
                  <Field label="资料标题" wide><input value={asset.title} disabled={!canEdit} onChange={event => setAsset(current => ({ ...current, title: event.target.value }))} placeholder="例如：服务认证或项目案例" className="kb-input" /></Field>
                  <Field label="资料内容" wide><textarea value={asset.content} disabled={!canEdit} onChange={event => setAsset(current => ({ ...current, content: event.target.value }))} placeholder="填写可被文章准确引用的事实" className="kb-input min-h-28 resize-y" /></Field>
                  <Field label="证据等级"><select value={asset.evidenceLevel} disabled={!canEdit} onChange={event => setAsset(current => ({ ...current, evidenceLevel: event.target.value as GeoEvidenceLevel }))} className="kb-input">{EVIDENCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
                  <Field label="标签"><input value={asset.tags} disabled={!canEdit} onChange={event => setAsset(current => ({ ...current, tags: event.target.value }))} placeholder="认证、服务、地区" className="kb-input" /></Field>
                  <Field label="来源网址（每行一个）" wide><textarea value={asset.sourceUrls} disabled={!canEdit} onChange={event => setAsset(current => ({ ...current, sourceUrls: event.target.value }))} placeholder="https://..." className="kb-input min-h-20 resize-y" /></Field>
                </div>
                {canEdit ? <button type="button" onClick={commitAsset} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#1677FF] px-3 text-xs font-semibold text-white transition hover:bg-[#0958D9]">{editingAssetId ? <CheckCircle2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editingAssetId ? "更新资料" : "加入资料库"}</button> : null}
              </section>
            </div>

            <section className="mt-4 overflow-hidden rounded-lg border border-[#D8E7F7] bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h3 className="text-sm font-bold text-slate-900">事实资料清单</h3><p className="mt-0.5 text-[11px] text-slate-500">冲突、过期、待审核和已归档资料不会进入文章生成。</p></div><span className="text-xs text-slate-400">{knowledgeBase.assets.length} 条</span></div>
              {knowledgeBase.assets.length === 0 ? <div className="px-4 py-10 text-center text-xs text-slate-400">尚未添加事实资料</div> : <div className="divide-y divide-slate-100">{knowledgeBase.assets.map(item => (
                <div key={item.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[130px_minmax(0,1fr)_auto] sm:items-start">
                  <div><span className="rounded-md bg-blue-50 px-2 py-1 text-[10px] font-semibold text-[#0958D9]">{KIND_OPTIONS.find(option => option.value === item.kind)?.label || "其他"}</span><div className="mt-2 text-[10px] text-slate-400">{STATUS_OPTIONS.find(option => option.value === item.status)?.label || item.status}</div></div>
                  <div className="min-w-0"><div className="truncate text-xs font-semibold text-slate-800">{item.title}</div><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{item.content}</p>{item.sourceUrls.length > 0 ? <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-600"><Link2 className="h-3 w-3" />{item.sourceUrls.length} 个来源</div> : null}</div>
                  {canEdit ? <div className="flex items-center gap-1"><button type="button" onClick={() => editAsset(item)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-blue-50 hover:text-[#0958D9]" aria-label={`编辑${item.title}`}><PencilLine className="h-3.5 w-3.5" /></button><button type="button" onClick={() => removeAsset(item.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" aria-label={`删除${item.title}`}><Trash2 className="h-3.5 w-3.5" /></button></div> : null}
                </div>
              ))}</div>}
            </section>
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
          <p className={`min-h-4 text-[11px] ${notice.includes("失败") || notice.includes("其他设备") ? "text-rose-600" : "text-slate-500"}`} role="status">{notice || (canEdit ? `资料库版本 ${knowledgeBase?.revision || 1}` : "当前为只读资料库")}</p>
          <div className="flex items-center gap-2"><button type="button" onClick={onClose} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600">关闭</button>{canEdit && knowledgeBase ? <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存到云端</button> : null}</div>
        </footer>
      </div>
      <style jsx global>{`.kb-input{width:100%;min-height:2.5rem;border:1px solid #dbe7f3;border-radius:.5rem;background:#f8fbff;padding:.6rem .75rem;font-size:.75rem;line-height:1.25rem;color:#1e293b;outline:none;transition:border-color .15s,box-shadow .15s,background .15s}.kb-input:focus{border-color:#69b1ff;background:#fff;box-shadow:0 0 0 3px rgba(22,119,255,.1)}.kb-input:disabled{cursor:not-allowed;background:#f1f5f9;color:#64748b}`}</style>
    </div>
  )
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={`text-[11px] font-medium text-slate-500 ${wide ? "sm:col-span-2" : ""}`}><span className="mb-1 block">{label}</span>{children}</label>
}

function HealthMetric({ label, value }: { label: string; value: string }) {
  return <div className="bg-white px-4 py-3"><div className="text-[10px] font-medium text-slate-400">{label}</div><div className="mt-1 text-lg font-bold text-slate-900">{value}</div></div>
}
