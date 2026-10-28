"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { toPng } from "html-to-image"
import type { Element, Root, RootContent } from "hast"
import {
  Atom,
  AudioLines,
  BatteryFull,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Copy,
  Compass,
  Download,
  Ellipsis,
  EllipsisVertical,
  Forward,
  Globe,
  Highlighter,
  History,
  LayoutGrid,
  Lightbulb,
  Link2,
  LoaderCircle,
  Menu,
  MessageCircleMore,
  MessageCirclePlus,
  Phone,
  Plus,
  RotateCw,
  Search,
  Signal,
  Smartphone,
  SquareArrowOutUpRight,
  Maximize2,
  Sparkles,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  Volume2,
  VolumeX,
  Wifi,
  X,
} from "lucide-react"
import { MODEL_LABELS } from "@/lib/model-labels"
import type { ModelKey, PenetrationByModel, PenetrationItem, PenetrationSource } from "@/types"

/**
 * Shows one detection answer the way the model's own phone app lays it out,
 * styled after real screenshots of each app. The answer text is the detected
 * one; only the surrounding interface is a reconstruction, and every export
 * says so.
 */

type Skin = "doubao" | "qwen" | "deepseek" | "kimi" | "yuanbao" | "ernie" | "zhipu"

const SKIN_BY_MODEL: Record<ModelKey, Skin> = {
  doubao: "doubao",
  qwen: "qwen",
  deepseek: "deepseek",
  kimi: "kimi",
  hunyuan: "yuanbao",
  ernie: "ernie",
  zhipu: "zhipu",
}

const APP_NAMES: Record<Skin, string> = {
  doubao: "豆包",
  qwen: "千问",
  deepseek: "DeepSeek",
  kimi: "Kimi",
  yuanbao: "元宝",
  ernie: "文小言",
  zhipu: "智谱清言",
}

interface SkinStyle {
  bubble: string
  body: string
  heading: string
  bullet: string
  footer: string
  placeholder: string
}

const SKIN_STYLES: Record<Skin, SkinStyle> = {
  doubao: {
    bubble: "rounded-[18px] bg-[#0066FF] px-4 py-2.5 text-white",
    body: "text-[15.5px] leading-[1.72] text-[#1F2329]",
    heading: "text-[17px] font-bold text-[#1F2329]",
    bullet: "marker:text-[#1F2329]",
    footer: "内容由 AI 生成，请注意甄别",
    placeholder: "发消息或按住说话...",
  },
  qwen: {
    bubble: "rounded-2xl bg-[#EBF5FF] px-4 py-2.5 text-[#222]",
    body: "text-[15px] leading-[1.75] text-[#222]",
    heading: "text-[17px] font-semibold text-[#222]",
    bullet: "marker:text-[#222]",
    footer: "内容由 AI 生成，请谨慎甄别",
    placeholder: "发消息或按住说话...",
  },
  deepseek: {
    bubble: "rounded-[22px] bg-[#EDF3FE] px-4 py-3 text-[#262626]",
    body: "text-[16.5px] leading-[1.8] text-[#262626]",
    heading: "text-[20px] font-bold text-[#262626]",
    bullet: "marker:text-[#8C8C8C]",
    footer: "回答由 AI 生成，仅供参考",
    placeholder: "发消息或按住说话",
  },
  kimi: {
    bubble: "rounded-2xl bg-[#F2F3F5] px-4 py-2.5 text-[#1A1A1A]",
    body: "text-[15px] leading-[1.75] text-[#1A1A1A]",
    heading: "text-[16px] font-bold text-[#1A1A1A]",
    bullet: "marker:text-[#2B7FFF]",
    footer: "内容由 AI 生成",
    placeholder: "尽管问，带图也行",
  },
  yuanbao: {
    bubble: "rounded-[12px_2px_12px_12px] bg-[#F3F3F3] px-3.5 py-2.5 text-black/90",
    body: "text-[16.5px] leading-[1.8] text-black/90",
    heading: "text-[19px] font-bold text-black/90",
    bullet: "marker:text-black/70",
    footer: "内容由AI生成，注意核实",
    placeholder: "发消息或按住说话...",
  },
  ernie: {
    bubble: "rounded-2xl bg-[#DCEBFF] px-4 py-2.5 text-[#1F1F1F]",
    body: "text-[15.5px] leading-[1.75] text-[#1F1F1F]",
    heading: "text-[17px] font-bold text-[#1F1F1F]",
    bullet: "marker:text-[#1F1F1F]",
    footer: "内容由AI生成",
    placeholder: "发消息或按住说话",
  },
  zhipu: {
    bubble: "rounded-[20px] bg-[#F2F3F5] px-4 py-3 text-[#1A1A1A]",
    body: "text-[17px] leading-[1.95] text-[#1A1A1A]",
    heading: "text-[19px] font-bold text-[#1A1A1A]",
    bullet: "marker:text-[#1A1A1A]",
    footer: "",
    placeholder: "有什么我能帮助你的吗",
  },
}

// Models mark sources as [1], [^1], [^1^], [ref_1], [citation:1] or 【1†source】.
const CITATION_PATTERN = /\[\^(\d{1,3})\^?\]|\[(?:ref_|citation:)(\d{1,3})\]|【(\d{1,3})†[^】]*】|\[(\d{1,3})\](?!\()/g
const FOOTNOTE_DEFINITION = /^\s*\[\^\d{1,3}\^?\]:.*$/gm
const CITE_HREF = "#cite-"

function withCitationLinks(answer: string): string {
  return answer
    .replace(FOOTNOTE_DEFINITION, "")
    .replace(CITATION_PATTERN, (_m, a, b, c, d) => `[${a || b || c || d}](${CITE_HREF}${a || b || c || d})`)
}

function uniqueSources(item: PenetrationItem): PenetrationSource[] {
  const seen = new Set<string>()
  return (item.searchSources || []).filter(source => {
    const key = source.url || source.title
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sourceName(source: PenetrationSource | undefined, max: number): string {
  const name = (source?.title || source?.domain || "").trim()
  return name.length > max ? `${name.slice(0, max)}...` : name
}

function sourceDomain(source: PenetrationSource | undefined, max: number): string {
  const domain = (source?.domain || "").replace(/^www\./, "")
  return domain.length > max ? `${domain.slice(0, max)}...` : domain
}

function conversationTitle(question: string): string {
  const title = question.trim().replace(/[？?。！!，,]+$/, "")
  return title.length > 14 ? `${title.slice(0, 14)}…` : title
}

function clockTime(iso?: string): string {
  const date = iso ? new Date(iso) : new Date()
  if (Number.isNaN(date.getTime())) return "9:41"
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`
}

/** The model the detection called, as 智谱清言 shows it in its title bar. */
function displayModelName(item: PenetrationItem): string {
  const model = item.requestAudits?.find(audit => audit.model)?.model?.trim()
  return model ? model.replace(/^glm/i, "GLM") : "GLM"
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Wraps every mention of the client's brand names in <mark>, outside code. */
function rehypeHighlight(terms: string[]) {
  const sorted = [...new Set(terms.map(term => term.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
  const lower = new Set(sorted.map(term => term.toLowerCase()))
  const pattern = sorted.length ? new RegExp(`(${sorted.map(escapeRegExp).join("|")})`, "gi") : null

  function visit(node: Root | Element) {
    if (node.type === "element" && ["code", "pre", "mark", "a"].includes(node.tagName)) return
    const children = node.children as RootContent[]
    node.children = children.flatMap((child): RootContent[] => {
      if (child.type === "element") {
        visit(child)
        return [child]
      }
      if (child.type !== "text" || !pattern) return [child]
      const parts = child.value.split(pattern).filter(Boolean)
      if (parts.length < 2 && !lower.has(child.value.toLowerCase())) return [child]
      return parts.map((part): RootContent => lower.has(part.toLowerCase())
        ? { type: "element", tagName: "mark", properties: {}, children: [{ type: "text", value: part }] }
        : { type: "text", value: part })
    }) as typeof node.children
  }

  return () => (tree: Root) => {
    if (pattern) visit(tree)
  }
}

function Citation({ skin, index, source }: { skin: Skin; index: number; source?: PenetrationSource }) {
  const chip = <CitationChip skin={skin} index={index} source={source} />
  if (!source?.url) return chip
  return (
    <a href={source.url} target="_blank" rel="noreferrer" title={source.title || source.url} className="hover:opacity-70">
      {chip}
    </a>
  )
}

function CitationChip({ skin, index, source }: { skin: Skin; index: number; source?: PenetrationSource }) {
  if (skin === "doubao" && source) {
    return (
      <span className="mx-0.5 inline-block rounded-md bg-[#F2F3F5] px-1.5 align-[1px] text-[11px] leading-[18px] text-[#646A73]">
        {sourceName(source, 6)}
      </span>
    )
  }
  if (skin === "kimi" && source) {
    return (
      <span className="mx-0.5 inline-block rounded-full bg-[#F2F3F5] px-2 align-[1px] text-[12px] leading-[20px] text-[#7A7A7A]">
        {sourceDomain(source, 12)}
      </span>
    )
  }
  if (skin === "yuanbao") {
    return (
      <span className="mx-0.5 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#F0F0F0] align-[-2px] text-[#999]">
        <Link2 className="h-3 w-3" />
      </span>
    )
  }
  return (
    <span className="mx-0.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[5px] bg-[#F0F0F0] px-1 align-[2px] text-[10px] leading-none text-[#8C8C8C]">
      {index}
    </span>
  )
}

function StatusBar({ time }: { time: string }) {
  return (
    <div className="flex h-8 items-center justify-between px-6 text-[14px] font-semibold text-black">
      <span>{time}</span>
      <span className="flex items-center gap-1.5">
        <Signal className="h-[14px] w-[14px]" strokeWidth={2.5} />
        <Wifi className="h-[14px] w-[14px]" strokeWidth={2.5} />
        <BatteryFull className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
    </div>
  )
}

const ICON = "h-[22px] w-[22px] text-[#1F1F1F]"

function AppHeader({ skin, title, modelName }: { skin: Skin; title: string; modelName: string }) {
  if (skin === "doubao") {
    return (
      <div className="flex h-[52px] items-center gap-3 px-4">
        <Menu className={ICON} />
        <SquarePen className={ICON} />
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-[15px] font-semibold text-[#1F2329]">{title}</div>
          <div className="text-[10px] text-[#8F959E]">AI 生成可能有误 注意核实</div>
        </div>
        <Phone className={ICON} />
        <VolumeX className={ICON} />
      </div>
    )
  }
  if (skin === "qwen") {
    return (
      <div className="flex h-[52px] items-center gap-3 px-4">
        <Menu className={ICON} />
        <SquarePen className={ICON} />
        <div className="flex flex-1 justify-center">
          <div className="flex items-center rounded-full bg-[#F2F3F5] p-[3px] text-[13px]">
            <span className="rounded-full bg-white px-3 py-1 font-semibold text-[#222] shadow-sm">快速</span>
            <span className="px-3 py-1 font-semibold text-[#999]">千问Go!</span>
          </div>
        </div>
        <VolumeX className={ICON} />
        <LayoutGrid className={ICON} />
      </div>
    )
  }
  if (skin === "deepseek") {
    return (
      <div className="flex h-[52px] items-center gap-4 px-4">
        <Menu className={ICON} />
        <div className="min-w-0 flex-1 truncate text-[17px] font-medium text-[#262626]">{title}</div>
        <VolumeX className={ICON} />
        <MessageCirclePlus className={ICON} />
      </div>
    )
  }
  if (skin === "kimi") {
    return (
      <div className="flex h-[52px] items-center gap-3 px-4">
        <Menu className={ICON} />
        <div className="rounded-full bg-[#F2F3F5] px-3 py-1 text-[14px]">
          <span className="font-semibold text-[#1A1A1A]">快速</span>
          <span className="ml-1.5 text-[#999]">进阶</span>
        </div>
        <div className="flex-1" />
        <MessageCirclePlus className={ICON} />
        <EllipsisVertical className={ICON} />
      </div>
    )
  }
  if (skin === "yuanbao") {
    return (
      <div className="flex h-[56px] items-center justify-between px-3">
        <div className="flex items-center gap-3 rounded-full bg-white px-3 py-2 shadow-[0_1px_6px_rgba(0,0,0,0.06)]">
          <Menu className={ICON} />
          <span className="pr-1 text-[17px] font-semibold text-black/90">元宝</span>
        </div>
        <div className="flex items-center gap-4 rounded-full bg-white px-3.5 py-2 shadow-[0_1px_6px_rgba(0,0,0,0.06)]">
          <VolumeX className={ICON} />
          <Phone className={ICON} />
          <MessageCirclePlus className={ICON} />
        </div>
      </div>
    )
  }
  if (skin === "ernie") {
    return (
      <div className="flex h-[52px] items-center px-4">
        <Menu className={ICON} />
        <div className="flex flex-1 justify-center">
          <div className="flex items-center rounded-full bg-[#F2F3F5] p-[3px] text-[14px]">
            <span className="flex items-center gap-0.5 rounded-full bg-white px-4 py-1 font-semibold text-[#1F1F1F] shadow-sm">
              对话<ChevronDown className="h-3 w-3" />
            </span>
            <span className="px-4 py-1 text-[#999]">工作</span>
          </div>
        </div>
        <VolumeX className={ICON} />
      </div>
    )
  }
  return (
    <div className="flex h-[60px] items-center gap-3 px-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white shadow-[0_1px_6px_rgba(0,0,0,0.07)]">
        <History className={ICON} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[17px] font-semibold text-[#1A1A1A]">
        {modelName}
        <span className="ml-1.5 text-[14px] font-normal text-[#999]">快速 ›</span>
      </span>
      <span className="flex shrink-0 items-center gap-4 rounded-full bg-white px-3.5 py-2.5 shadow-[0_1px_6px_rgba(0,0,0,0.07)]">
        <MessageCirclePlus className={ICON} />
        <Ellipsis className={ICON} />
      </span>
    </div>
  )
}

function SearchSummary({
  skin,
  item,
  sourceCount,
  open,
  onToggle,
}: {
  skin: Skin
  item: PenetrationItem
  sourceCount: number
  open: boolean
  onToggle: () => void
}) {
  const queries = (item.searchQueries || []).filter(Boolean)
  if (skin === "kimi") {
    const steps = queries.length ? queries.slice(0, 2) : sourceCount ? ["检索相关资料"] : []
    if (!steps.length) return null
    return (
      <button type="button" onClick={onToggle} className="mb-3 block w-full space-y-2 text-left text-[13.5px] text-[#8A8A8A]">
        <span className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 shrink-0" />
          web_search 检索相关资料
          <ChevronRight className={`h-3.5 w-3.5 transition ${open ? "rotate-90" : ""}`} />
        </span>
        {steps.map(query => (
          <span key={query} className="flex items-center gap-2 pl-0.5">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">搜索网页 {query}</span>
          </span>
        ))}
      </button>
    )
  }
  if (!sourceCount) return null
  const label = {
    doubao: queries.length ? `搜索 ${queries.length} 个关键词，参考 ${sourceCount} 篇资料` : `参考 ${sourceCount} 篇资料`,
    qwen: `已完成分析，共参考 ${sourceCount} 篇资料`,
    deepseek: `搜索到 ${sourceCount} 个网页`,
    yuanbao: `找到 ${sourceCount} 篇相关资料`,
    ernie: `共参考${sourceCount}篇资料`,
    zhipu: `${sourceCount}个来源`,
  }[skin]
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`mb-3 flex items-center gap-0.5 text-left text-[#8F959E] ${skin === "deepseek" ? "text-[15px]" : "text-[13px]"}`}
    >
      {label}
      {skin === "ernie" ? null : <ChevronRight className={`h-3.5 w-3.5 transition ${open ? "rotate-90" : ""}`} />}
    </button>
  )
}

function SourceList({ sources }: { sources: PenetrationSource[] }) {
  return (
    <ol className="mb-4 space-y-2 rounded-xl bg-[#F7F8FA] p-3">
      {sources.map((source, index) => (
        <li key={source.url || index}>
          <a
            href={source.url || undefined}
            target="_blank"
            rel="noreferrer"
            title={source.url}
            className="group flex gap-2 text-[12.5px] leading-[1.5]"
          >
            <span className="mt-[1px] flex h-4 min-w-4 items-center justify-center rounded bg-white px-1 text-[10px] text-[#8F959E]">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-1 text-[#1F2329] group-hover:text-[#0066FF] group-hover:underline">{source.title || source.domain}</span>
              <span className="block truncate text-[11px] text-[#8F959E]">{source.domain}</span>
            </span>
            {source.url ? <SquareArrowOutUpRight className="mt-[3px] h-3 w-3 shrink-0 text-[#B8BCC2] group-hover:text-[#0066FF]" /> : null}
          </a>
        </li>
      ))}
    </ol>
  )
}

function AnswerActions({ skin }: { skin: Skin }) {
  const cls = "h-[19px] w-[19px] text-[#8A8F99]"
  const left: Record<Skin, ReactNode[]> = {
    doubao: [<Copy key="c" className={cls} />, <Volume2 key="v" className={cls} />, <ThumbsUp key="u" className={cls} />, <ThumbsDown key="d" className={cls} />, <Forward key="f" className={cls} />],
    qwen: [<Volume2 key="v" className={cls} />, <Forward key="f" className={cls} />, <Copy key="c" className={cls} />, <ThumbsUp key="u" className={cls} />, <ThumbsDown key="d" className={cls} />],
    deepseek: [<Copy key="c" className={cls} />, <ThumbsUp key="u" className={cls} />, <ThumbsDown key="d" className={cls} />, <Volume2 key="v" className={cls} />, <Forward key="f" className={cls} />],
    kimi: [<Volume2 key="v" className={cls} />, <Copy key="c" className={cls} />],
    yuanbao: [<Copy key="c" className={cls} />, <ThumbsUp key="u" className={cls} />, <ThumbsDown key="d" className={cls} />, <Forward key="f" className={cls} />],
    ernie: [<Copy key="c" className={cls} />, <Volume2 key="v" className={cls} />, <SquareArrowOutUpRight key="s" className={cls} />],
    zhipu: [<Copy key="c" className={cls} />, <Volume2 key="v" className={cls} />, <SquareArrowOutUpRight key="s" className={cls} />],
  }
  const right = {
    doubao: <RotateCw className={cls} />,
    qwen: null,
    deepseek: <RotateCw className={cls} />,
    kimi: <Forward className={cls} />,
    yuanbao: <RotateCw className={cls} />,
    ernie: (
      <span className="flex items-center gap-1 rounded-full border border-[#EBEDF0] px-2.5 py-1 text-[12px] text-[#646A73]">
        <Globe className="h-3.5 w-3.5" />源
      </span>
    ),
    zhipu: null,
  }[skin]
  return (
    <div className="mt-4 flex items-center gap-5">
      {left[skin]}
      <span className="flex-1" />
      {right}
    </div>
  )
}

function BottomBar({ skin }: { skin: Skin }) {
  const style = SKIN_STYLES[skin]
  const footer = <div className="pb-2 pt-1.5 text-center text-[10px] text-[#B8BCC2]">{style.footer}</div>
  const chip = "flex shrink-0 items-center gap-1 rounded-full border border-[#EBEDF0] bg-white px-3 py-1.5 text-[12.5px] text-[#1F2329]"

  if (skin === "deepseek") {
    return (
      <div className="px-3 pt-2">
        <div className="rounded-[24px] border border-[#ECECEC] bg-white px-3.5 pb-3 pt-3.5 shadow-[0_-2px_12px_rgba(0,0,0,0.04)]">
          <div className="mb-3 text-[15px] text-[#B3B3B3]">{style.placeholder}</div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 rounded-full border border-[#E5E5E5] px-3 py-1.5 text-[13px] text-[#262626]">
              <Atom className="h-4 w-4" />深度思考
            </span>
            <span className="flex items-center gap-1 rounded-full border border-[#C3D3FF] bg-[#DBEAFE] px-3 py-1.5 text-[13px] text-[#4D6BFE]">
              <Globe className="h-4 w-4" />智能搜索
            </span>
            <span className="flex-1" />
            <CirclePlus className="h-7 w-7 text-[#262626]" strokeWidth={1.5} />
            <AudioLines className="h-7 w-7 rounded-full border-[1.5px] border-[#262626] p-1 text-[#262626]" />
          </div>
        </div>
        {footer}
      </div>
    )
  }
  if (skin === "kimi") {
    return (
      <div className="px-3 pt-2">
        <div className="flex items-center gap-3 rounded-full bg-[#F2F3F5] px-4 py-3">
          <Plus className="h-5 w-5 text-[#1A1A1A]" />
          <span className="flex-1 text-[15px] text-[#A3A3A3]">{style.placeholder}</span>
          <AudioLines className="h-5 w-5 text-[#1A1A1A]" />
        </div>
        {footer}
      </div>
    )
  }

  if (skin === "ernie") {
    return (
      <div className="px-3 pt-2">
        <div className="mb-2 flex gap-2 overflow-hidden">
          <span className={chip}><Compass className="h-3.5 w-3.5" />更多技能<ChevronRight className="h-3 w-3" /></span>
          <span className={chip}>放心写</span>
          <span className={chip}>面试辅导</span>
          <span className={chip}>PPT</span>
        </div>
        <div className="flex items-center gap-3 rounded-full bg-[#F2F3F5] px-4 py-3">
          <AudioLines className="h-6 w-6 rounded-full border-[1.5px] border-[#1F1F1F] p-[3px] text-[#1F1F1F]" />
          <span className="flex-1 text-[15px] text-[#A3A8B0]">{style.placeholder}</span>
          <Camera className="h-5 w-5 text-[#1F1F1F]" />
          <CirclePlus className="h-6 w-6 text-[#1F1F1F]" />
        </div>
        {footer}
      </div>
    )
  }
  if (skin === "zhipu") {
    return (
      <div className="px-3 pt-2">
        <div className="flex items-center gap-3 rounded-[28px] bg-white px-4 py-3.5 shadow-[0_1px_12px_rgba(0,0,0,0.08)]">
          <CirclePlus className="h-6 w-6 text-[#1A1A1A]" />
          <span className="flex-1 text-[16px] text-[#A3A8B0]">{style.placeholder}</span>
          <AudioLines className="h-6 w-6 rounded-full border-[1.5px] border-[#1A1A1A] p-[3px] text-[#1A1A1A]" />
        </div>
        <div className="flex items-center justify-around pb-3 pt-4">
          <MessageCircleMore className="h-7 w-7 fill-[#1A1A1A] text-white" />
          <Compass className="h-7 w-7 text-[#1A1A1A]" />
          <span className="relative">
            <UserRound className="h-7 w-7 text-[#1A1A1A]" />
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#F5455C]" />
          </span>
        </div>
      </div>
    )
  }

  const chips: Partial<Record<Skin, ReactNode[]>> = {
    doubao: [
      <span key="a" className={chip}><Atom className="h-3.5 w-3.5" />深度思考</span>,
      <span key="b" className={chip}>拍题答疑</span>,
      <span key="c" className={chip}>AI 创作</span>,
      <span key="d" className={chip}>翻译</span>,
    ],
    qwen: [
      <span key="a" className={chip}><Atom className="h-3.5 w-3.5" />思考研究</span>,
      <span key="b" className={chip}>工作助理</span>,
      <span key="c" className={chip}>AI 生图</span>,
      <span key="d" className={chip}>拍照解题</span>,
    ],
    yuanbao: [
      <span key="a" className={`${chip} text-[#00A870]`}><Sparkles className="h-3.5 w-3.5" />深度<ChevronRight className="h-3 w-3" /></span>,
      <span key="b" className={chip}>AI创作</span>,
      <span key="c" className={chip}>拍题答疑</span>,
      <span key="d" className={chip}>AI录音</span>,
    ],
  }

  return (
    <div className="px-3 pt-2">
      {chips[skin] ? <div className="mb-2 flex gap-2 overflow-hidden">{chips[skin]}</div> : null}
      <div
        className={`flex items-center gap-3 px-4 py-3 ${
          skin === "yuanbao"
            ? "rounded-[26px] bg-white shadow-[0_1px_10px_rgba(0,0,0,0.07)]"
            : skin === "qwen"
              ? "rounded-full border border-[#E5E6EB] bg-white"
              : "rounded-full bg-[#F2F3F5]"
        }`}
      >
        {skin === "qwen" ? null : <Camera className="h-5 w-5 text-[#1F2329]" />}
        <span className="flex-1 text-[15px] text-[#A3A8B0]">{style.placeholder}</span>
        {skin === "qwen" ? <Camera className="h-5 w-5 text-[#1F2329]" /> : <AudioLines className="h-5 w-5 text-[#1F2329]" />}
        <CirclePlus className="h-5 w-5 text-[#1F2329]" />
      </div>
      {footer}
    </div>
  )
}

function AnswerBody({
  skin,
  answer,
  sources,
  highlightTerms,
}: {
  skin: Skin
  answer: string
  sources: PenetrationSource[]
  highlightTerms: string[]
}) {
  const style = SKIN_STYLES[skin]
  const markdown = useMemo(() => withCitationLinks(answer), [answer])
  const rehypePlugins = useMemo(() => [rehypeHighlight(highlightTerms)], [highlightTerms])
  const linkColor = skin === "deepseek" ? "text-[#4D6BFE]" : skin === "yuanbao" ? "text-[#00A870]" : "text-[#0066FF]"

  const components = useMemo<Components>(() => ({
    h1: ({ children }) => <h3 className={`mb-2 mt-5 ${style.heading}`}>{children}</h3>,
    h2: ({ children }) => <h3 className={`mb-2 mt-5 ${style.heading}`}>{children}</h3>,
    h3: ({ children }) => <h3 className={`mb-2 mt-4 ${style.heading}`}>{children}</h3>,
    h4: ({ children }) => <h4 className="mb-1.5 mt-3 font-bold">{children}</h4>,
    p: ({ children }) => <p className="my-2.5">{children}</p>,
    ul: ({ children }) => <ul className={`my-2 list-disc space-y-1.5 pl-5 ${style.bullet}`}>{children}</ul>,
    ol: ({ children }) => <ol className={`my-2 list-decimal space-y-1.5 pl-5 ${style.bullet}`}>{children}</ol>,
    li: ({ children }) => <li className="pl-0.5">{children}</li>,
    strong: ({ children }) => <strong className="font-bold">{children}</strong>,
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-[3px] border-[#E5E6EB] pl-3 text-[#8F959E]">{children}</blockquote>
    ),
    hr: () => <hr className="my-4 border-[#EEEFF1]" />,
    code: ({ children }) => <code className="rounded bg-[#F2F3F5] px-1 py-0.5 text-[0.9em]">{children}</code>,
    pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-xl bg-[#F7F8FA] p-3 text-[13px]">{children}</pre>,
    mark: ({ children }) => <mark className="rounded-[3px] bg-[#FFE58F] px-0.5 text-inherit">{children}</mark>,
    table: ({ children }) => (
      <div className="my-3 overflow-hidden rounded-xl border border-[#EEEFF1] bg-white">
        {skin === "zhipu" ? (
          <div className="flex items-center gap-4 border-b border-[#EEEFF1] px-3 py-2.5 text-[14px] text-[#1A1A1A]">
            <span className="flex-1">表格</span>
            <Maximize2 className="h-4 w-4 text-[#666]" />
            <Copy className="h-4 w-4 text-[#666]" />
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px] leading-[1.6]">{children}</table>
        </div>
        {skin === "qwen" ? (
          <div className="flex items-center gap-4 border-t border-[#F2F3F5] px-3 py-2 text-[11px] text-[#999]">
            <span>复制</span><span>下载</span><span className="flex-1 text-right">全屏</span>
          </div>
        ) : null}
      </div>
    ),
    th: ({ children }) => <th className="bg-[#F7F8FA] px-3 py-2 text-left font-semibold">{children}</th>,
    td: ({ children }) => <td className="border-t border-[#F2F3F5] px-3 py-2 align-top">{children}</td>,
    a: ({ href, children }) => {
      if (href?.startsWith(CITE_HREF)) {
        const index = Number(href.slice(CITE_HREF.length))
        return <Citation skin={skin} index={index} source={sources[index - 1]} />
      }
      return <span className={linkColor}>{children}</span>
    },
    img: () => null,
  }), [skin, sources, style, linkColor])

  return (
    <div className={`break-words ${style.body}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

function PhoneScreen({
  model,
  item,
  highlightTerms,
  capturing,
}: {
  model: ModelKey
  item: PenetrationItem
  highlightTerms: string[]
  capturing: boolean
}) {
  const skin = SKIN_BY_MODEL[model]
  const style = SKIN_STYLES[skin]
  const sources = useMemo(() => uniqueSources(item), [item])
  const sourceCount = sources.length || item.sourceCount || 0
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const screenBg = skin === "yuanbao" ? "bg-[#F7F8FA]" : "bg-white"
  // 智谱清言 lists its sources under the answer instead of above it.
  const sourcesAtEnd = skin === "zhipu"
  const sourceSummary = (
    <>
      <SearchSummary
        skin={skin}
        item={item}
        sourceCount={sourceCount}
        open={sourcesOpen}
        onToggle={() => setSourcesOpen(open => !open)}
      />
      {sourcesOpen && sources.length ? <SourceList sources={sources} /> : null}
    </>
  )

  return (
    <div className={`flex flex-col ${screenBg} ${capturing ? "" : "h-full"}`}>
      <div className={screenBg}>
        <StatusBar time={clockTime(item.sampledAt)} />
        <AppHeader skin={skin} title={conversationTitle(item.question)} modelName={displayModelName(item)} />
      </div>
      <div className={capturing ? "" : "min-h-0 flex-1 overflow-y-auto"}>
        <div className="px-4 pb-5 pt-2">
          {skin === "yuanbao" || skin === "ernie" ? (
            <div className="mb-3 text-center text-[13px] text-[#A3A8B0]">{clockTime(item.sampledAt)}</div>
          ) : skin === "zhipu" ? (
            <div className="mb-3 text-center text-[13px] text-[#A3A8B0]">内容由AI生成，仅供参考和借鉴</div>
          ) : null}
          <div className="mb-5 flex justify-end">
            <div className={`max-w-[80%] whitespace-pre-wrap break-words text-[15.5px] leading-[1.6] ${style.bubble}`}>
              {item.question}
            </div>
          </div>
          {sourcesAtEnd ? null : sourceSummary}
          {item.answer.trim() ? (
            <AnswerBody skin={skin} answer={item.answer} sources={sources} highlightTerms={highlightTerms} />
          ) : (
            <div className="text-[14px] text-[#8F959E]">本次没有返回回答原文。</div>
          )}
          {sourcesAtEnd ? <div className="mt-4">{sourceSummary}</div> : null}
          {skin === "deepseek" && sourceCount ? (
            <>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#ECECEC] px-3.5 py-2 text-[14px] text-[#262626]">
                <Globe className="h-4 w-4 text-[#4D6BFE]" />
                {sourceCount} 个网页
              </div>
              <div className="mt-3 text-[13.5px] italic text-[#8C8C8C]">本回答由 AI 生成，内容仅供参考，请仔细甄别</div>
            </>
          ) : null}
          <AnswerActions skin={skin} />
        </div>
      </div>
      <div className={screenBg}>
        <BottomBar skin={skin} />
      </div>
    </div>
  )
}

function ordinalOf(items: PenetrationItem[], index: number): number {
  const question = items[index]?.question.trim()
  return items.slice(0, index).filter(item => item.question.trim() === question).length
}

/** The same question's answer from another model, matching which repeat it was. */
export function matchingIndex(items: PenetrationItem[], question: string, ordinal: number): number {
  const indexes = items.flatMap((item, index) => (item.question.trim() === question ? [index] : []))
  return indexes[Math.min(ordinal, indexes.length - 1)] ?? -1
}

function exportFileName(appName: string, question: string): string {
  const safe = question.trim().replace(/[\\/:*?"<>|\s]+/g, "").slice(0, 20)
  return `${appName}-${safe || "回答"}.png`
}

function useLongImageExport() {
  const captureRef = useRef<HTMLDivElement>(null)
  const [capturing, setCapturing] = useState(false)
  const [exportError, setExportError] = useState("")

  async function exportImage(fileName: string) {
    if (capturing) return
    setExportError("")
    setCapturing(true)
    try {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const node = captureRef.current
      if (!node) return
      // Browsers refuse canvases much taller than ~16k pixels.
      const pixelRatio = Math.max(1, Math.min(2, 16000 / node.scrollHeight))
      const dataUrl = await toPng(node, { pixelRatio, backgroundColor: "#ffffff", cacheBust: true })
      const link = document.createElement("a")
      link.href = dataUrl
      link.download = fileName
      link.click()
    } catch {
      setExportError("长图生成失败，请稍后重试。")
    } finally {
      setCapturing(false)
    }
  }

  return { captureRef, capturing, exportError, exportImage }
}

function PhoneFrame({
  model,
  item,
  highlightTerms,
  capturing,
  captureRef,
  screenHeight,
}: {
  model: ModelKey
  item: PenetrationItem
  highlightTerms: string[]
  capturing: boolean
  captureRef: RefObject<HTMLDivElement | null>
  screenHeight: string
}) {
  return (
    <div className="mx-auto w-full max-w-[390px] rounded-[44px] bg-[#111] p-[10px] shadow-2xl">
      <div className="overflow-hidden rounded-[34px] bg-white">
        <div ref={captureRef} className="bg-white">
          <div className={capturing ? "" : screenHeight}>
            <PhoneScreen model={model} item={item} highlightTerms={highlightTerms} capturing={capturing} />
          </div>
          {capturing ? (
            <div className="border-t border-slate-100 bg-[#FAFAFA] px-4 py-2.5 text-center text-[10px] leading-4 text-slate-400">
              界面还原展示 · 回答原文由势途 GEO
              {item.sampledAt ? ` 于 ${new Date(item.sampledAt).toLocaleString("zh-CN")} ` : " "}
              通过 {MODEL_LABELS[model]} 联网检测获得
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function HighlightToggle({ on, disabled, onToggle }: { on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition disabled:opacity-40 ${
        on ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-500"
      }`}
    >
      <Highlighter className="h-3.5 w-3.5" />
      {on ? "已高亮我方品牌" : "不高亮品牌"}
    </button>
  )
}

function ExportButton({ capturing, disabled, onExport }: { capturing: boolean; disabled: boolean; onExport: () => void }) {
  return (
    <button
      type="button"
      onClick={onExport}
      disabled={disabled || capturing}
      className="inline-flex h-7 items-center gap-1 rounded-md bg-[#1677FF] px-2.5 text-[11px] font-medium text-white transition hover:bg-[#0958D9] disabled:opacity-60"
    >
      {capturing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      导出手机长图
    </button>
  )
}

/** One answer shown in its model's phone app, in place on the page. */
export function InlineMobileAnswer({
  model,
  item,
  ourBrand,
  brandAliases = [],
}: {
  model: ModelKey
  item: PenetrationItem
  ourBrand: string
  brandAliases?: string[]
}) {
  const [highlight, setHighlight] = useState(true)
  const { captureRef, capturing, exportError, exportImage } = useLongImageExport()
  const skin = SKIN_BY_MODEL[model]
  const highlightTerms = useMemo(
    () => (highlight ? [ourBrand, ...brandAliases] : []),
    [highlight, ourBrand, brandAliases],
  )

  return (
    <div className="w-full max-w-[390px]">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <HighlightToggle on={highlight} disabled={!ourBrand.trim()} onToggle={() => setHighlight(on => !on)} />
        <ExportButton
          capturing={capturing}
          disabled={false}
          onExport={() => exportImage(exportFileName(APP_NAMES[skin], item.question))}
        />
        {exportError ? <span className="text-[11px] text-rose-600">{exportError}</span> : null}
      </div>
      <PhoneFrame
        key={`${model}-${item.sampleId || item.question}`}
        model={model}
        item={item}
        highlightTerms={highlightTerms}
        capturing={capturing}
        captureRef={captureRef}
        screenHeight="h-[680px]"
      />
      <p className="mt-2 text-center text-[11px] leading-5 text-slate-400">
        界面按 {APP_NAMES[skin]} App 样式还原，回答内容为本次真实检测结果
      </p>
    </div>
  )
}

export function MobileAnswerButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-slate-200 bg-white px-1.5 text-[10px] font-medium text-slate-600 transition hover:border-[#1677FF] hover:text-[#1677FF]"
      title="按该模型手机 App 的对话界面查看这条回答"
    >
      <Smartphone className="h-3 w-3" />
      手机端视图
    </button>
  )
}

export default function MobileAnswerDialog({
  byModel,
  initialModel,
  initialIndex,
  ourBrand,
  brandAliases = [],
  onClose,
}: {
  byModel: PenetrationByModel
  initialModel: ModelKey
  initialIndex: number
  ourBrand: string
  brandAliases?: string[]
  onClose: () => void
}) {
  const [model, setModel] = useState(initialModel)
  const [index, setIndex] = useState(initialIndex)
  const [highlight, setHighlight] = useState(true)
  const { captureRef, capturing, exportError, exportImage } = useLongImageExport()

  const items = byModel[model] ?? []
  const item = items[index]
  const question = item?.question.trim() ?? ""
  const ordinal = item ? ordinalOf(items, index) : 0
  const skin = SKIN_BY_MODEL[model]
  const highlightTerms = useMemo(
    () => (highlight ? [ourBrand, ...brandAliases] : []),
    [highlight, ourBrand, brandAliases],
  )
  const siblingModels = (Object.keys(byModel) as ModelKey[]).filter(key =>
    (byModel[key] ?? []).some(other => other.question.trim() === question),
  )

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  function switchModel(next: ModelKey) {
    const nextIndex = matchingIndex(byModel[next] ?? [], question, ordinal)
    if (nextIndex < 0) return
    setModel(next)
    setIndex(nextIndex)
  }

  if (typeof document === "undefined") return null

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-900/60 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${APP_NAMES[skin]} 手机端视图`}
    >
      <div className="w-full max-w-[420px]" onClick={event => event.stopPropagation()}>
        <div className="mb-3 rounded-xl bg-white p-3 shadow-lg">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-[#1677FF]" />
            <span className="text-sm font-semibold text-slate-800">手机端视图</span>
            <span className="text-xs text-slate-400">
              {items.length ? `${index + 1} / ${items.length}` : ""}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setIndex(i => Math.max(0, i - 1))}
              disabled={index <= 0}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 disabled:opacity-40"
              aria-label="上一条回答"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setIndex(i => Math.min(items.length - 1, i + 1))}
              disabled={index >= items.length - 1}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 disabled:opacity-40"
              aria-label="下一条回答"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {siblingModels.length > 1 ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {siblingModels.map(key => (
                <button
                  key={key}
                  type="button"
                  onClick={() => switchModel(key)}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                    key === model
                      ? "bg-[#1677FF] text-white"
                      : "border border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:text-[#1677FF]"
                  }`}
                >
                  {APP_NAMES[SKIN_BY_MODEL[key]]}
                </button>
              ))}
            </div>
          ) : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <HighlightToggle on={highlight} disabled={!ourBrand.trim()} onToggle={() => setHighlight(on => !on)} />
            <ExportButton
              capturing={capturing}
              disabled={!item}
              onExport={() => item && exportImage(exportFileName(APP_NAMES[skin], item.question))}
            />
            {exportError ? <span className="text-[11px] text-rose-600">{exportError}</span> : null}
          </div>
        </div>

        {item ? (
          <PhoneFrame
            key={`${model}-${index}`}
            model={model}
            item={item}
            highlightTerms={highlightTerms}
            capturing={capturing}
            captureRef={captureRef}
            screenHeight="h-[min(760px,calc(100vh-220px))] min-h-[520px]"
          />
        ) : null}
        <p className="mt-3 text-center text-[11px] leading-5 text-white/80">
          界面按 {APP_NAMES[skin]} App 样式还原，回答内容为本次真实检测结果；导出的长图底部会注明这一点。
        </p>
      </div>
    </div>,
    document.body,
  )
}
