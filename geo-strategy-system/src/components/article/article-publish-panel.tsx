"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Check,
  Circle,
  ExternalLink,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Table2,
  UserCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  countMarkdownTables,
  extractMarkdownTitle,
  preparePublishArticle,
} from "@/lib/article-publishing/content"
import {
  MULTIPOST_CHROME_STORE_URL,
  MULTIPOST_PROJECT_URL,
  MultiPostBridgeError,
  checkMultiPostExtension,
  getMultiPostArticlePlatforms,
  openMultiPostOptions,
  publishArticleWithMultiPost,
  refreshMultiPostAccounts,
  requestMultiPostTrust,
  type MultiPostPlatform,
} from "@/lib/article-publishing/multipost-bridge"
import type { ArticlePublishingSettings } from "@/types"

type ConnectionState = "checking" | "missing" | "untrusted" | "ready" | "error"

interface Props {
  markdown: string
  getRenderedHtml: () => string
  fallbackTitle: string
  settings?: ArticlePublishingSettings
  onSettingsChange: (patch: Partial<ArticlePublishingSettings>) => void
}

const CORE_PLATFORM_ORDER = [
  "ARTICLE_WEIXIN",
  "ARTICLE_ZHIHU",
  "ARTICLE_CSDN",
  "ARTICLE_TOUTIAO",
  "ARTICLE_BAIJIAHAO",
  "ARTICLE_SOHU",
  "ARTICLE_NETEASE",
  "ARTICLE_QQ",
  "ARTICLE_JIANSHU",
  "ARTICLE_JUEJIN",
]

export default function ArticlePublishPanel({
  markdown,
  getRenderedHtml,
  fallbackTitle,
  settings = {},
  onSettingsChange,
}: Props) {
  const [connection, setConnection] = useState<ConnectionState>("checking")
  const [platforms, setPlatforms] = useState<MultiPostPlatform[]>([])
  const [loadingPlatforms, setLoadingPlatforms] = useState(false)
  const [authorizing, setAuthorizing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selected = useMemo(() => new Set(settings.selectedPlatforms || []), [settings.selectedPlatforms])
  const derivedTitle = useMemo(
    () => extractMarkdownTitle(markdown, fallbackTitle),
    [fallbackTitle, markdown],
  )
  const tableCount = useMemo(() => countMarkdownTables(markdown), [markdown])
  const visiblePlatforms = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return platforms
      .filter(platform => {
        if (!normalizedQuery) return true
        return `${platform.platformName} ${platform.name} ${platform.accountInfo?.username || ""}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      })
      .sort(comparePlatforms)
  }, [platforms, query])

  const loadPlatforms = useCallback(async () => {
    setLoadingPlatforms(true)
    setError(null)
    try {
      const next = await getMultiPostArticlePlatforms()
      setPlatforms(next)
      setNotice(next.length > 0 ? `已读取 ${next.length} 个文章平台。` : "扩展未返回文章平台。")
    } catch (loadError) {
      handleBridgeFailure(loadError, setConnection, setError, true)
    } finally {
      setLoadingPlatforms(false)
    }
  }, [])

  const connect = useCallback(async () => {
    setConnection("checking")
    setError(null)
    setNotice(null)
    try {
      await checkMultiPostExtension()
      setConnection("ready")
      await loadPlatforms()
    } catch (connectError) {
      handleBridgeFailure(connectError, setConnection, setError)
    }
  }, [loadPlatforms])

  useEffect(() => {
    const timer = window.setTimeout(() => void connect(), 0)
    return () => window.clearTimeout(timer)
  }, [connect])

  async function authorizeOrigin() {
    setAuthorizing(true)
    setError(null)
    try {
      const result = await requestMultiPostTrust()
      if (!result.trusted) {
        setConnection("untrusted")
        setError(result.message || "当前网站未获发布扩展授权。")
        return
      }
      await connect()
    } catch (authError) {
      handleBridgeFailure(authError, setConnection, setError)
    } finally {
      setAuthorizing(false)
    }
  }

  function togglePlatform(name: string) {
    const next = new Set(selected)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    onSettingsChange({ selectedPlatforms: Array.from(next) })
    setError(null)
    setNotice(null)
  }

  async function openAccountRefresh() {
    setError(null)
    try {
      await refreshMultiPostAccounts()
      setNotice("账号刷新窗口已打开，完成后点击重新读取。")
    } catch (refreshError) {
      handleBridgeFailure(refreshError, setConnection, setError, true)
    }
  }

  async function openOptions() {
    setError(null)
    try {
      await openMultiPostOptions()
    } catch (optionsError) {
      handleBridgeFailure(optionsError, setConnection, setError, true)
    }
  }

  async function publish() {
    if (connection !== "ready") {
      setError("请先连接并授权本机发布扩展。")
      return
    }

    const selectedPlatforms = platforms.filter(platform => selected.has(platform.name))
    if (selectedPlatforms.length === 0) {
      setError("请至少选择一个发布平台。")
      return
    }

    const coverUrl = settings.coverUrl?.trim() || ""
    if (coverUrl && !/^https?:\/\//i.test(coverUrl)) {
      setError("封面地址需要使用 http 或 https 的完整网址。")
      return
    }

    setPublishing(true)
    setError(null)
    setNotice(null)
    try {
      const prepared = preparePublishArticle({
        markdown,
        renderedHtml: getRenderedHtml(),
        title: settings.title,
        fallbackTitle,
        digest: settings.digest,
        tags: settings.tags,
      })
      if (!prepared.htmlContent || !prepared.markdownContent) {
        throw new Error("文章内容为空，请先生成或填写文章。")
      }

      const cover = coverUrl ? createRemoteFile(coverUrl, "article-cover") : undefined
      await publishArticleWithMultiPost({
        platforms: selectedPlatforms.map(platform => ({
          name: platform.name,
          injectUrl: platform.injectUrl,
          extraConfig: platform.extraConfig,
        })),
        isAutoPublish: settings.publishMode === "auto",
        data: {
          title: prepared.title,
          digest: prepared.digest,
          htmlContent: prepared.htmlContent,
          markdownContent: prepared.markdownContent,
          ...(cover ? { cover } : {}),
          images: prepared.images,
          tags: prepared.tags,
          original: settings.original === true,
          allowComment: settings.allowComment !== false,
        },
      })
      setNotice(
        settings.publishMode === "auto"
          ? `已交给本机发布器，正在处理 ${selectedPlatforms.length} 个平台。`
          : `已打开 ${selectedPlatforms.length} 个平台的发布流程，请在平台页面确认内容。`,
      )
    } catch (publishError) {
      handleBridgeFailure(publishError, setConnection, setError, true)
    } finally {
      setPublishing(false)
    }
  }

  if (connection !== "ready") {
    return (
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-blue-100 bg-[#f4f9ff] px-4 text-center">
          {connection === "checking" ? (
            <Loader2 className="h-7 w-7 animate-spin text-[#1677FF]" />
          ) : connection === "untrusted" ? (
            <ShieldCheck className="h-7 w-7 text-[#1677FF]" />
          ) : (
            <Plug className="h-7 w-7 text-slate-500" />
          )}
          <div>
            <div className="text-sm font-semibold text-slate-900">{connectionLabel(connection)}</div>
            {error && <div className="mt-1 max-w-xl text-xs leading-5 text-rose-600">{error}</div>}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {connection === "untrusted" && (
              <Button size="sm" onClick={() => void authorizeOrigin()} disabled={authorizing}>
                {authorizing ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                授权当前网站
              </Button>
            )}
            {connection !== "checking" && connection !== "untrusted" && (
              <Button size="sm" variant="outline" onClick={() => void connect()}>
                <RefreshCw />
                重新检测
              </Button>
            )}
            <Button size="sm" variant="outline" asChild>
              <a href={MULTIPOST_CHROME_STORE_URL} target="_blank" rel="noreferrer">
                <ExternalLink />
                安装发布扩展
              </a>
            </Button>
          </div>
          <a
            href={MULTIPOST_PROJECT_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-slate-400 underline-offset-2 hover:text-[#0958D9] hover:underline"
          >
            开源项目与权限说明
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00C8FF] text-white shadow-sm">
            <Send className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">多平台发布</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span>{selected.size} 个平台</span>
              {tableCount > 0 && (
                <span className="inline-flex items-center gap-1 text-[#0958D9]"><Table2 className="h-3 w-3" />{tableCount} 个表格</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void openAccountRefresh()}>
            <UserCheck />
            刷新账号
          </Button>
          <Button size="sm" variant="outline" onClick={() => void loadPlatforms()} disabled={loadingPlatforms}>
            <RefreshCw className={loadingPlatforms ? "animate-spin" : ""} />
            重新读取
          </Button>
          <Button size="icon" variant="outline" onClick={() => void openOptions()} title="发布扩展设置">
            <Settings />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          <span className="mb-1.5 block font-medium text-slate-600">文章标题</span>
          <Input
            value={settings.title || ""}
            onChange={event => onSettingsChange({ title: event.target.value })}
            placeholder={derivedTitle}
          />
        </label>
        <label className="text-xs">
          <span className="mb-1.5 block font-medium text-slate-600">标签</span>
          <Input
            value={settings.tags || ""}
            onChange={event => onSettingsChange({ tags: event.target.value })}
            placeholder="GEO, AI 搜索, 品牌"
          />
        </label>
        <label className="text-xs sm:col-span-2">
          <span className="mb-1.5 block font-medium text-slate-600">摘要</span>
          <Textarea
            value={settings.digest || ""}
            onChange={event => onSettingsChange({ digest: event.target.value })}
            placeholder="留空时自动提取正文摘要"
            className="min-h-20 resize-y"
          />
        </label>
        <label className="text-xs sm:col-span-2">
          <span className="mb-1.5 block font-medium text-slate-600">封面图片网址</span>
          <Input
            value={settings.coverUrl || ""}
            onChange={event => onSettingsChange({ coverUrl: event.target.value })}
            placeholder="https://...（部分平台要求封面）"
          />
        </label>
      </div>

      <div className="grid gap-3 border-y border-slate-100 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <div className="mb-2 text-xs font-medium text-slate-600">发布方式</div>
          <div className="grid max-w-md grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => onSettingsChange({ publishMode: "review" })}
              className={modeClass(settings.publishMode !== "auto")}
            >
              检查后发布
            </button>
            <button
              type="button"
              onClick={() => onSettingsChange({ publishMode: "auto" })}
              className={modeClass(settings.publishMode === "auto")}
            >
              自动发布
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-slate-600">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.original === true}
              onChange={event => onSettingsChange({ original: event.target.checked })}
              className="h-4 w-4 accent-[#1677FF]"
            />
            原创声明
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.allowComment !== false}
              onChange={event => onSettingsChange({ allowComment: event.target.checked })}
              className="h-4 w-4 accent-[#1677FF]"
            />
            允许评论
          </label>
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs font-semibold text-slate-700">选择文章平台</div>
          <label className="relative block sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索平台或账号"
              className="h-8 pl-8 text-xs"
            />
          </label>
        </div>

        {loadingPlatforms && platforms.length === 0 ? (
          <div className="flex h-32 items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-[#1677FF]" />
            正在读取平台登录状态...
          </div>
        ) : (
          <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
            {visiblePlatforms.map(platform => {
              const active = selected.has(platform.name)
              const accountName = platform.accountInfo?.username || platform.accountInfo?.accountId
              return (
                <button
                  key={platform.name}
                  type="button"
                  onClick={() => togglePlatform(platform.name)}
                  className={`flex min-h-16 items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                    active
                      ? "border-[#69b1ff] bg-[#e6f4ff] shadow-[0_4px_14px_-10px_rgba(22,119,255,0.8)]"
                      : "border-slate-200 bg-white hover:border-[#91caff] hover:bg-[#f5faff]"
                  }`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    active ? "border-[#1677FF] bg-[#1677FF] text-white" : "border-slate-300 text-transparent"
                  }`}>
                    {active ? <Check className="h-3 w-3" /> : <Circle className="h-2.5 w-2.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-slate-800">{platform.platformName}</span>
                    <span className={`mt-1 block truncate text-[10px] ${accountName ? "text-emerald-600" : "text-slate-400"}`}>
                      {accountName || "未识别登录账号"}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700">
          {notice}
        </div>
      )}

      <Button
        type="button"
        onClick={() => void publish()}
        disabled={publishing || selected.size === 0 || !markdown.trim()}
        className="h-11 w-full rounded-lg"
      >
        {publishing ? <Loader2 className="animate-spin" /> : <Send />}
        {publishing
          ? "正在交给本机发布器..."
          : settings.publishMode === "auto"
            ? `发布到 ${selected.size} 个平台`
            : `打开 ${selected.size} 个平台检查`}
      </Button>
    </div>
  )
}

function connectionLabel(connection: ConnectionState): string {
  if (connection === "checking") return "正在检测本机发布扩展"
  if (connection === "untrusted") return "需要授权当前网站"
  if (connection === "missing") return "未检测到 MultiPost 发布扩展"
  return "本机发布扩展连接失败"
}

function handleBridgeFailure(
  error: unknown,
  setConnection: (state: ConnectionState) => void,
  setError: (message: string | null) => void,
  keepReady = false,
) {
  if (error instanceof MultiPostBridgeError) {
    if (error.code === 403) setConnection("untrusted")
    else if (!keepReady && error.code === "TIMEOUT") setConnection("missing")
    else if (!keepReady) setConnection("error")
    setError(error.message)
    return
  }
  if (!keepReady) setConnection("error")
  setError(error instanceof Error ? error.message : "发布扩展调用失败。")
}

function comparePlatforms(a: MultiPostPlatform, b: MultiPostPlatform): number {
  const aLoggedIn = Boolean(a.accountInfo?.username || a.accountInfo?.accountId)
  const bLoggedIn = Boolean(b.accountInfo?.username || b.accountInfo?.accountId)
  if (aLoggedIn !== bLoggedIn) return aLoggedIn ? -1 : 1

  const aIndex = CORE_PLATFORM_ORDER.indexOf(a.name)
  const bIndex = CORE_PLATFORM_ORDER.indexOf(b.name)
  if (aIndex !== bIndex) {
    if (aIndex < 0) return 1
    if (bIndex < 0) return -1
    return aIndex - bIndex
  }
  return a.platformName.localeCompare(b.platformName, "zh-CN")
}

function createRemoteFile(url: string, fallbackName: string) {
  try {
    const parsed = new URL(url)
    const name = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || fallbackName)
    return { name, url }
  } catch {
    return { name: fallbackName, url }
  }
}

function modeClass(active: boolean): string {
  return active
    ? "h-8 rounded-md bg-white text-[#003eb3] shadow-sm"
    : "h-8 rounded-md text-slate-500 transition hover:bg-white/70"
}
