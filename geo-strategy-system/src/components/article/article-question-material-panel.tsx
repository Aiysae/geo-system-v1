"use client"

import { useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { createBackgroundRequestId } from "@/lib/background-job-client"
import {
  ARTICLE_QUESTION_TEMPLATE_URL,
  parseArticleQuestionFile,
} from "@/lib/article-question-import-client"
import type { ArticleQuestionImportPreview } from "@/lib/article-question-import"
import { toUserFacingError } from "@/lib/user-facing-errors"
import type {
  ArticleQuestionMaterial,
  ArticleQuestionMaterialImportResult,
} from "@/types"

interface Props {
  clientId: string
  materials: ArticleQuestionMaterial[]
  loading: boolean
  loadError?: string
  onRefresh: () => Promise<void>
  onUseMaterial: (material: ArticleQuestionMaterial) => void
}

type DeleteResponse = {
  ok?: boolean
  deletedCount?: number
  error?: string
}

export default function ArticleQuestionMaterialPanel({
  clientId,
  materials,
  loading,
  loadError,
  onRefresh,
  onUseMaterial,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ArticleQuestionImportPreview | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [lastImportBatchId, setLastImportBatchId] = useState("")
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  const recentMaterials = useMemo(
    () => materials.slice(0, 100),
    [materials],
  )
  const selectedCount = selectedIds.size

  async function chooseFile(nextFile?: File) {
    if (!nextFile) return
    setParsing(true)
    setFile(nextFile)
    setPreview(null)
    setNotice("")
    setError("")
    try {
      setPreview(await parseArticleQuestionFile(nextFile))
    } catch (parseError) {
      setError(toUserFacingError(parseError, {
        fallback: "Excel 读取失败，请检查文件格式后重试。",
        subject: "文章素材导入",
      }))
    } finally {
      setParsing(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function importPreview() {
    if (!file || !preview || preview.rows.length === 0 || importing) return
    setImporting(true)
    setNotice("")
    setError("")
    const importBatchId = createBackgroundRequestId("aqi")
    try {
      const response = await apiFetch("/api/article-generation/question-materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          importBatchId,
          sourceFileName: file.name,
          rows: preview.rows,
        }),
      })
      const result = await readApiJson<ArticleQuestionMaterialImportResult & { error?: string }>(
        response,
        "文章素材导入",
      )
      if (!response.ok) throw new Error(result.error || "文章素材导入失败")
      const totalSkipped = preview.skipped.length + result.skippedCount
      setLastImportBatchId(result.importBatchId)
      setNotice(
        `已导入 ${result.createdCount} 条`
        + (totalSkipped > 0 ? `，跳过 ${totalSkipped} 条` : "")
        + (result.warningCount > 0 ? `；${result.warningCount} 条暂未填写匹配优势` : ""),
      )
      setFile(null)
      setPreview(null)
      await onRefresh()
    } catch (importError) {
      setError(toUserFacingError(importError, {
        fallback: "文章素材导入失败，请稍后重试。",
        subject: "文章素材导入",
      }))
    } finally {
      setImporting(false)
    }
  }

  async function deleteMaterials(args: { ids?: string[]; importBatchId?: string }) {
    if (deleting) return
    setDeleting(true)
    setError("")
    try {
      const response = await apiFetch("/api/article-generation/question-materials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, ...args }),
      })
      const result = await readApiJson<DeleteResponse>(response, "文章素材删除")
      if (!response.ok) throw new Error(result.error || "文章素材删除失败")
      setSelectedIds(new Set())
      if (args.importBatchId) setLastImportBatchId("")
      setNotice(`已删除 ${result.deletedCount || 0} 条文章素材。`)
      await onRefresh()
    } catch (deleteError) {
      setError(toUserFacingError(deleteError, {
        fallback: "文章素材删除失败，请稍后重试。",
        subject: "文章素材",
      }))
    } finally {
      setDeleting(false)
    }
  }

  function toggleSelected(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  return (
    <section className="rounded-lg border border-blue-100 bg-white">
      <header className="flex flex-col gap-3 border-b border-slate-100 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <FileSpreadsheet className="h-4 w-4 text-[#1677FF]" />
            Excel 疑问句与优势
          </div>
          <div className="mt-1 text-[11px] leading-4 text-slate-500">
            每行保持“一条疑问句 + 一条匹配优势”，导入后可跨设备使用
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={ARTICLE_QUESTION_TEMPLATE_URL}
            download
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-200 bg-white px-2.5 text-[11px] font-semibold text-[#0958D9] transition hover:bg-blue-50"
          >
            <Download className="h-3.5 w-3.5" />
            下载模板
          </a>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={event => void chooseFile(event.target.files?.[0])}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={parsing || importing}
            className="h-8 gap-1.5 border-cyan-200 text-cyan-700"
          >
            {parsing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            选择 Excel
          </Button>
        </div>
      </header>

      {preview && file && (
        <div className="border-b border-slate-100 bg-[#F7FBFF] px-3 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-slate-700" title={file.name}>
                {file.name}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                识别 {preview.totalDataRows} 行 · 可导入 {preview.rows.length} 条
                {preview.skipped.length > 0 ? ` · 文件内跳过 ${preview.skipped.length} 条` : ""}
                {preview.warningCount > 0 ? ` · ${preview.warningCount} 条缺少优势` : ""}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => void importPreview()}
              disabled={importing}
              className="h-8 shrink-0 gap-1.5 bg-gradient-to-r from-[#1677FF] to-[#00B8D9] text-white"
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
              一键导入 {preview.rows.length} 条
            </Button>
          </div>
          <div className="mt-2 max-h-32 divide-y divide-blue-100 overflow-y-auto border-y border-blue-100">
            {preview.rows.slice(0, 12).map(row => (
              <div key={`${row.rowNumber}:${row.question}`} className="grid gap-1 py-1.5 text-[10px] sm:grid-cols-[42px_minmax(0,1.2fr)_minmax(0,1fr)]">
                <span className="text-slate-400">第 {row.rowNumber} 行</span>
                <span className="text-slate-700">{row.question}</span>
                <span className={row.matchedAdvantage ? "text-emerald-700" : "text-amber-600"}>
                  {row.matchedAdvantage || "未填写匹配优势"}
                </span>
              </div>
            ))}
          </div>
          {preview.skipped.length > 0 && (
            <div className="mt-2 text-[10px] leading-4 text-amber-700">
              {preview.skipped.slice(0, 3).map(item => (
                <div key={`${item.rowNumber}:${item.message}`}>
                  第 {item.rowNumber} 行：{item.message}
                </div>
              ))}
              {preview.skipped.length > 3 && (
                <div>另有 {preview.skipped.length - 3} 条未展示</div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-slate-500">
            云端素材 <strong className="text-slate-700">{materials.length}</strong> 条
            {selectedCount > 0 ? ` · 已选 ${selectedCount} 条` : ""}
          </div>
          <div className="flex items-center gap-1.5">
            {lastImportBatchId && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={deleting}
                onClick={() => {
                  if (window.confirm("确认撤销刚才整批导入的文章素材吗？")) {
                    void deleteMaterials({ importBatchId: lastImportBatchId })
                  }
                }}
                className="h-7 gap-1 px-2 text-[10px]"
              >
                <Undo2 className="h-3 w-3" />
                撤销本次导入
              </Button>
            )}
            {selectedCount > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={deleting}
                onClick={() => {
                  if (window.confirm(`确认删除选中的 ${selectedCount} 条文章素材吗？`)) {
                    void deleteMaterials({ ids: [...selectedIds] })
                  }
                }}
                className="h-7 gap-1 border-rose-200 px-2 text-[10px] text-rose-600"
              >
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                删除
              </Button>
            )}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => void onRefresh()}
              disabled={loading}
              className="h-7 w-7"
              title="刷新云端文章素材"
              aria-label="刷新云端文章素材"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {loadError && (
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-rose-600">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {loadError}
          </div>
        )}
        {error && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-rose-50 px-2.5 py-2 text-[11px] text-rose-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {notice}
          </div>
        )}

        {loading && materials.length === 0 ? (
          <div className="flex h-20 items-center justify-center text-[11px] text-slate-400">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            正在读取云端素材
          </div>
        ) : materials.length === 0 ? (
          <div className="mt-2 rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-[11px] text-slate-400">
            还没有 Excel 导入素材，可先下载模板填写
          </div>
        ) : (
          <div className="mt-2 max-h-48 divide-y divide-slate-100 overflow-y-auto border-y border-slate-100">
            {recentMaterials.map(material => (
              <div key={material.id} className="grid grid-cols-[22px_minmax(0,1fr)] gap-1.5 py-2">
                <input
                  type="checkbox"
                  checked={selectedIds.has(material.id)}
                  onChange={() => toggleSelected(material.id)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[#1677FF]"
                  aria-label={`选择 ${material.question}`}
                />
                <button
                  type="button"
                  onClick={() => onUseMaterial(material)}
                  className="min-w-0 text-left"
                  title="将这条疑问句和匹配优势填入单篇文章"
                >
                  <span className="block text-[11px] leading-4 text-slate-700">{material.question}</span>
                  <span className={`mt-0.5 block truncate text-[10px] ${
                    material.matchedAdvantage ? "text-emerald-700" : "text-amber-600"
                  }`}>
                    {material.matchedAdvantage || "未填写匹配优势"}
                  </span>
                </button>
              </div>
            ))}
            {materials.length > recentMaterials.length && (
              <div className="py-2 text-center text-[10px] text-slate-400">
                当前显示最近 {recentMaterials.length} 条，批量与自动成文可使用全部 {materials.length} 条
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
