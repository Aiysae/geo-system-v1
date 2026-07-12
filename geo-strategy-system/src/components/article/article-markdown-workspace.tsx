"use client"

import { useMemo, useRef, useState, type CSSProperties } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  CheckCircle2,
  Clipboard,
  Code2,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileDown,
  FileText,
  Palette,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type WorkspaceTab = "edit" | "preview" | "export"
type ThemeKey = "default" | "wechat"
type CopyState = "idle" | "markdown" | "html"

interface Props {
  value: string
  onChange: (value: string) => void
  fileBaseName: string
  title: string
  statusText: string
  placeholder: string
}

interface MarkdownTheme {
  label: string
  description: string
  page: CSSProperties
  article: CSSProperties
  h1: CSSProperties
  h2: CSSProperties
  h3: CSSProperties
  p: CSSProperties
  a: CSSProperties
  strong: CSSProperties
  blockquote: CSSProperties
  ul: CSSProperties
  ol: CSSProperties
  li: CSSProperties
  code: CSSProperties
  pre: CSSProperties
  tableWrap: CSSProperties
  table: CSSProperties
  th: CSSProperties
  td: CSSProperties
  hr: CSSProperties
}

const MARKDOWN_THEMES: Record<ThemeKey, MarkdownTheme> = {
  default: {
    label: "默认文章",
    description: "适合后台留档、博客和文档导出",
    page: {
      background: "#f8fafc",
      color: "#0f172a",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif",
    },
    article: {
      maxWidth: "760px",
      margin: "0 auto",
      padding: "28px",
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: "14px",
      lineHeight: 1.82,
      fontSize: "15px",
    },
    h1: {
      margin: "0 0 22px",
      paddingBottom: "14px",
      borderBottom: "2px solid #0f766e",
      color: "#0f172a",
      fontSize: "28px",
      lineHeight: 1.28,
      fontWeight: 800,
    },
    h2: {
      margin: "30px 0 14px",
      paddingLeft: "12px",
      borderLeft: "4px solid #0ea5e9",
      color: "#0f172a",
      fontSize: "21px",
      lineHeight: 1.35,
      fontWeight: 760,
    },
    h3: {
      margin: "22px 0 10px",
      color: "#1e293b",
      fontSize: "17px",
      lineHeight: 1.45,
      fontWeight: 730,
    },
    p: {
      margin: "12px 0",
      color: "#334155",
      lineHeight: 1.85,
    },
    a: {
      color: "#0369a1",
      textDecoration: "underline",
      textUnderlineOffset: "3px",
    },
    strong: {
      color: "#0f172a",
      fontWeight: 760,
    },
    blockquote: {
      margin: "18px 0",
      padding: "12px 16px",
      borderLeft: "4px solid #38bdf8",
      background: "#f0f9ff",
      color: "#334155",
      borderRadius: "0 10px 10px 0",
    },
    ul: {
      margin: "12px 0",
      paddingLeft: "24px",
    },
    ol: {
      margin: "12px 0",
      paddingLeft: "24px",
    },
    li: {
      margin: "7px 0",
      color: "#334155",
    },
    code: {
      padding: "2px 6px",
      borderRadius: "6px",
      background: "#e2e8f0",
      color: "#0f172a",
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
      fontSize: "0.92em",
    },
    pre: {
      margin: "16px 0",
      padding: "14px",
      overflowX: "auto",
      borderRadius: "12px",
      background: "#0f172a",
      color: "#e2e8f0",
      lineHeight: 1.7,
    },
    tableWrap: {
      margin: "18px 0",
      overflowX: "auto",
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "14px",
    },
    th: {
      padding: "10px 12px",
      border: "1px solid #cbd5e1",
      background: "#e0f2fe",
      color: "#0f172a",
      fontWeight: 760,
      textAlign: "left",
    },
    td: {
      padding: "10px 12px",
      border: "1px solid #e2e8f0",
      color: "#334155",
      verticalAlign: "top",
    },
    hr: {
      margin: "28px 0",
      border: 0,
      borderTop: "1px solid #cbd5e1",
    },
  },
  wechat: {
    label: "公众号排版",
    description: "适合复制到微信公众号编辑器",
    page: {
      background: "#fff7ed",
      color: "#1f2937",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    },
    article: {
      maxWidth: "680px",
      margin: "0 auto",
      padding: "30px 24px",
      background: "#fffefb",
      border: "1px solid #fed7aa",
      borderRadius: "16px",
      lineHeight: 1.9,
      fontSize: "15px",
    },
    h1: {
      margin: "0 0 26px",
      padding: "0 0 16px",
      borderBottom: "3px solid #f97316",
      color: "#7c2d12",
      fontSize: "27px",
      lineHeight: 1.35,
      fontWeight: 800,
      textAlign: "center",
    },
    h2: {
      margin: "30px 0 16px",
      padding: "8px 12px",
      borderRadius: "10px",
      background: "#ffedd5",
      color: "#9a3412",
      fontSize: "20px",
      lineHeight: 1.4,
      fontWeight: 760,
    },
    h3: {
      margin: "22px 0 10px",
      color: "#c2410c",
      fontSize: "17px",
      lineHeight: 1.5,
      fontWeight: 730,
    },
    p: {
      margin: "13px 0",
      color: "#374151",
      lineHeight: 1.95,
    },
    a: {
      color: "#ea580c",
      textDecoration: "none",
      borderBottom: "1px solid #fdba74",
    },
    strong: {
      color: "#9a3412",
      fontWeight: 780,
    },
    blockquote: {
      margin: "18px 0",
      padding: "14px 16px",
      borderLeft: "4px solid #fb923c",
      background: "#fff7ed",
      color: "#4b5563",
      borderRadius: "0 12px 12px 0",
    },
    ul: {
      margin: "12px 0",
      paddingLeft: "22px",
    },
    ol: {
      margin: "12px 0",
      paddingLeft: "22px",
    },
    li: {
      margin: "7px 0",
      color: "#374151",
    },
    code: {
      padding: "2px 6px",
      borderRadius: "6px",
      background: "#ffedd5",
      color: "#9a3412",
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
      fontSize: "0.9em",
    },
    pre: {
      margin: "16px 0",
      padding: "14px",
      overflowX: "auto",
      borderRadius: "12px",
      background: "#431407",
      color: "#ffedd5",
      lineHeight: 1.7,
    },
    tableWrap: {
      margin: "18px 0",
      overflowX: "auto",
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "14px",
    },
    th: {
      padding: "10px 12px",
      border: "1px solid #fdba74",
      background: "#fed7aa",
      color: "#7c2d12",
      fontWeight: 760,
      textAlign: "left",
    },
    td: {
      padding: "10px 12px",
      border: "1px solid #fed7aa",
      color: "#374151",
      verticalAlign: "top",
    },
    hr: {
      margin: "28px 0",
      border: 0,
      borderTop: "1px solid #fdba74",
    },
  },
}

export default function ArticleMarkdownWorkspace({
  value,
  onChange,
  fileBaseName,
  title,
  statusText,
  placeholder,
}: Props) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("edit")
  const [themeKey, setThemeKey] = useState<ThemeKey>("default")
  const [copyState, setCopyState] = useState<CopyState>("idle")
  const previewRef = useRef<HTMLDivElement | null>(null)
  const hasContent = value.trim().length > 0
  const theme = MARKDOWN_THEMES[themeKey]

  const components = useMemo(() => createMarkdownComponents(theme), [theme])

  async function copyMarkdown() {
    if (!hasContent) return
    await navigator.clipboard.writeText(value)
    flashCopyState("markdown")
  }

  async function copyFormattedHtml() {
    if (!hasContent) return
    const html = getRenderedHtml(previewRef.current)
    if (!html) return

    try {
      if ("ClipboardItem" in window) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([value], { type: "text/plain" }),
          }),
        ])
      } else {
        await navigator.clipboard.writeText(html)
      }
      flashCopyState("html")
    } catch {
      await navigator.clipboard.writeText(html)
      flashCopyState("html")
    }
  }

  function exportMarkdown() {
    if (!hasContent) return
    downloadBlob(new Blob([value], { type: "text/markdown;charset=utf-8" }), `${fileBaseName}.md`)
  }

  function exportHtml() {
    if (!hasContent) return
    const html = buildStandaloneHtml(title, getRenderedHtml(previewRef.current), theme)
    downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), `${fileBaseName}.html`)
  }

  function exportWord() {
    if (!hasContent) return
    const html = buildStandaloneHtml(title, getRenderedHtml(previewRef.current), theme)
    downloadBlob(new Blob([html], { type: "application/msword;charset=utf-8" }), `${fileBaseName}.doc`)
  }

  function flashCopyState(next: CopyState) {
    setCopyState(next)
    window.setTimeout(() => setCopyState("idle"), 1400)
  }

  return (
    <section className="flex min-h-[620px] flex-col rounded-xl border border-slate-200/80 bg-white/90 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-900">生成结果</div>
            <div className="text-[11px] text-slate-500">{statusText}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={copyMarkdown} disabled={!hasContent}>
              {copyState === "markdown" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copyState === "markdown" ? "已复制" : "复制 MD"}
            </Button>
            <Button size="sm" variant="outline" onClick={copyFormattedHtml} disabled={!hasContent}>
              {copyState === "html" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
              {copyState === "html" ? "已复制" : "复制排版"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-xs font-semibold md:w-[330px]">
            <button type="button" onClick={() => setActiveTab("edit")} className={tabClass(activeTab === "edit")}>
              <Code2 className="h-3.5 w-3.5" />
              源码
            </button>
            <button type="button" onClick={() => setActiveTab("preview")} className={tabClass(activeTab === "preview")}>
              <Eye className="h-3.5 w-3.5" />
              预览
            </button>
            <button type="button" onClick={() => setActiveTab("export")} className={tabClass(activeTab === "export")}>
              <Download className="h-3.5 w-3.5" />
              导出
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-500">
            <Palette className="h-3.5 w-3.5 text-orange-500" />
            <select
              value={themeKey}
              onChange={event => setThemeKey(event.target.value as ThemeKey)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-blue-100"
            >
              {Object.entries(MARKDOWN_THEMES).map(([key, item]) => (
                <option key={key} value={key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <div className={activeTab === "edit" ? "h-full" : "hidden"}>
          <Textarea
            value={value}
            onChange={event => onChange(event.target.value)}
            placeholder={placeholder}
            className="h-full min-h-[560px] flex-1 resize-none rounded-none border-0 bg-transparent p-4 font-mono text-sm leading-7 shadow-none focus-visible:ring-0"
          />
        </div>

        <div className={activeTab === "preview" ? "h-full overflow-auto p-4" : "hidden"}>
          <div style={theme.page}>
            <div ref={previewRef}>
              <MarkdownPreview value={value} components={components} theme={theme} />
            </div>
          </div>
        </div>

        <div className={activeTab === "export" ? "space-y-4 p-4" : "hidden"}>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-900">排版主题</div>
            <div className="mt-1 text-xs leading-5 text-slate-500">{theme.description}</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={exportMarkdown}
              disabled={!hasContent}
              className="flex min-h-24 flex-col items-start justify-between rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-cyan-200 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileText className="h-5 w-5 text-cyan-700" />
              <span>
                <span className="block text-sm font-semibold text-slate-900">Markdown</span>
                <span className="mt-1 block text-xs text-slate-500">保留源码，适合二次编辑</span>
              </span>
            </button>
            <button
              type="button"
              onClick={exportHtml}
              disabled={!hasContent}
              className="flex min-h-24 flex-col items-start justify-between rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-orange-200 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileCode2 className="h-5 w-5 text-orange-600" />
              <span>
                <span className="block text-sm font-semibold text-slate-900">HTML</span>
                <span className="mt-1 block text-xs text-slate-500">保留当前排版样式</span>
              </span>
            </button>
            <button
              type="button"
              onClick={exportWord}
              disabled={!hasContent}
              className="flex min-h-24 flex-col items-start justify-between rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileDown className="h-5 w-5 text-emerald-700" />
              <span>
                <span className="block text-sm font-semibold text-slate-900">Word 文档</span>
                <span className="mt-1 block text-xs text-slate-500">适合交付和归档</span>
              </span>
            </button>
          </div>

        </div>
      </div>
    </section>
  )
}

function MarkdownPreview({
  value,
  components,
  theme,
}: {
  value: string
  components: Components
  theme: MarkdownTheme
}) {
  if (!value.trim()) {
    return (
      <article style={theme.article}>
        <p style={{ ...theme.p, color: "#94a3b8" }}>生成后的 Markdown 会在这里实时排版预览。</p>
      </article>
    )
  }

  return (
    <article style={theme.article}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {value}
      </ReactMarkdown>
    </article>
  )
}

function createMarkdownComponents(theme: MarkdownTheme): Components {
  return {
    h1: props => <h1 {...stripNode(props)} style={theme.h1} />,
    h2: props => <h2 {...stripNode(props)} style={theme.h2} />,
    h3: props => <h3 {...stripNode(props)} style={theme.h3} />,
    p: props => <p {...stripNode(props)} style={theme.p} />,
    a: props => <a {...stripNode(props)} style={theme.a} target="_blank" rel="noreferrer" />,
    strong: props => <strong {...stripNode(props)} style={theme.strong} />,
    blockquote: props => <blockquote {...stripNode(props)} style={theme.blockquote} />,
    ul: props => <ul {...stripNode(props)} style={theme.ul} />,
    ol: props => <ol {...stripNode(props)} style={theme.ol} />,
    li: props => <li {...stripNode(props)} style={theme.li} />,
    code: props => {
      const { className, children, ...rest } = stripNode(props)
      return (
      <code {...rest} className={className} style={theme.code}>
        {children}
      </code>
      )
    },
    pre: props => <pre {...stripNode(props)} style={theme.pre} />,
    table: props => (
      <div style={theme.tableWrap}>
        <table {...stripNode(props)} style={theme.table} />
      </div>
    ),
    th: props => <th {...stripNode(props)} style={theme.th} />,
    td: props => <td {...stripNode(props)} style={theme.td} />,
    hr: props => <hr {...stripNode(props)} style={theme.hr} />,
  }
}

function stripNode<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const { node, ...rest } = props
  void node
  return rest
}

function tabClass(active: boolean): string {
  return active
    ? "inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-white text-[#003EB3] shadow-sm"
    : "inline-flex h-8 items-center justify-center gap-1 rounded-lg text-slate-500 transition hover:bg-white/70"
}

function getRenderedHtml(node: HTMLDivElement | null): string {
  if (!node) return ""
  const clone = node.cloneNode(true) as HTMLElement
  clone.querySelectorAll("script,style,iframe,object,embed,form,input,button,textarea").forEach(element => {
    element.remove()
  })
  return clone.innerHTML.trim()
}

function buildStandaloneHtml(title: string, bodyHtml: string, theme: MarkdownTheme): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title || "文章")}</title>
  <style>
    body {
      margin: 0;
      padding: 32px 16px;
      background: ${theme.page.background || "#ffffff"};
      color: ${theme.page.color || "#111827"};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
