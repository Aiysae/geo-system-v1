import "server-only"

import { JSDOM } from "jsdom"
import robotsParser from "robots-parser"
import type { GeoAuditBotPolicy } from "@/types"

const BOTS: Array<Pick<GeoAuditBotPolicy, "key" | "label" | "userAgent"> & { directive: string }> = [
  { key: "generic", label: "通用爬虫", userAgent: "ShituGeoAuditBot", directive: "*" },
  { key: "oaiSearch", label: "ChatGPT 搜索", userAgent: "OAI-SearchBot", directive: "OAI-SearchBot" },
  { key: "gptBot", label: "OpenAI 训练爬虫", userAgent: "GPTBot", directive: "GPTBot" },
  { key: "googlebot", label: "Google 搜索", userAgent: "Googlebot", directive: "Googlebot" },
  { key: "claudeBot", label: "Claude 爬虫", userAgent: "ClaudeBot", directive: "ClaudeBot" },
  { key: "bytespider", label: "字节系爬虫", userAgent: "Bytespider", directive: "Bytespider" },
]

function hasExplicitDirective(content: string, directive: string): boolean {
  return content
    .split(/\r?\n/)
    .some(line => {
      const match = line.replace(/#.*$/, "").match(/^\s*user-agent\s*:\s*(.+?)\s*$/i)
      return match?.[1]?.toLowerCase() === directive.toLowerCase()
    })
}

export interface ParsedRobots {
  policies: GeoAuditBotPolicy[]
  sitemapUrls: string[]
  isAllowed: (url: string, userAgent?: string) => boolean
}

export function parseRobots(
  robotsUrl: string,
  content: string,
  targetUrl: string,
  availability: "available" | "missing" | "unknown",
): ParsedRobots {
  const parser = robotsParser(robotsUrl, availability === "available" ? content : "")
  const policies = BOTS.map(bot => {
    if (availability === "unknown") {
      return {
        ...bot,
        status: "unknown" as const,
        explicit: false,
        note: "robots.txt 无法读取，暂时不能确认访问规则。",
      }
    }

    const explicit = availability === "available" && hasExplicitDirective(content, bot.directive)
    const allowed = parser.isAllowed(targetUrl, bot.userAgent)
    const matchingLine = availability === "available"
      ? parser.getMatchingLineNumber(targetUrl, bot.userAgent)
      : -1
    return {
      key: bot.key,
      label: bot.label,
      userAgent: bot.userAgent,
      status: allowed === false ? "blocked" as const : "allowed" as const,
      explicit,
      ...(matchingLine > 0 ? { matchingLine } : {}),
      note: availability === "missing"
        ? "未设置 robots.txt，按协议默认允许访问。"
        : allowed === false
          ? "当前规则禁止访问目标页面。"
          : explicit
            ? "存在对应爬虫的明确允许规则。"
            : "未设置专属规则，当前沿用通用规则。",
    }
  })

  return {
    policies,
    sitemapUrls: availability === "available" ? parser.getSitemaps() : [],
    isAllowed: (url, userAgent = "ShituGeoAuditBot") => (
      availability === "unknown" || parser.isAllowed(url, userAgent) !== false
    ),
  }
}

export function parseSitemapXml(xml: string): {
  valid: boolean
  pageUrls: string[]
  sitemapUrls: string[]
} {
  try {
    const dom = new JSDOM(xml, { contentType: "text/xml" })
    const document = dom.window.document
    if (document.querySelector("parsererror")) {
      return { valid: false, pageUrls: [], sitemapUrls: [] }
    }
    const root = document.documentElement.localName.toLowerCase()
    const locations = Array.from(document.getElementsByTagName("loc"))
      .map(element => element.textContent?.trim() || "")
      .filter(Boolean)
    if (root === "sitemapindex") {
      return { valid: true, pageUrls: [], sitemapUrls: locations }
    }
    if (root === "urlset") {
      return { valid: true, pageUrls: locations, sitemapUrls: [] }
    }
    return { valid: false, pageUrls: [], sitemapUrls: [] }
  } catch {
    return { valid: false, pageUrls: [], sitemapUrls: [] }
  }
}

export function validateLlmsText(content: string): {
  valid: boolean
  summary: string
} {
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const hasH1 = lines.some(line => /^#\s+\S/.test(line))
  const linkCount = lines.filter(line => /\[[^\]]+\]\(https?:\/\/[^)]+\)/i.test(line)).length
  const valid = hasH1 && content.trim().length >= 80
  return {
    valid,
    summary: valid
      ? `格式可读取，包含 ${linkCount} 个资源链接。`
      : "文件存在，但缺少清晰的 H1、站点说明或可读取内容。",
  }
}
