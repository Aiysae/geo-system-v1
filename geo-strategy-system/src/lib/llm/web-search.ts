// 轻量级网页搜索：用于给"不带联网"的大模型（如 DeepSeek）做 Tool Calling 外挂。
//
// 设计取舍：
//   - 零依赖（不引入 duckduckgo-search / cheerio / playwright 等）。
//   - 并行查询 360、搜狗、Bing 与百度移动搜索，优先保留可还原真实目标网址的结果。
//   - 仅抽取标题 + 摘要 + 链接，限制条数与字符长度，避免吃满 LLM 上下文。
//
// 注意：HTML 解析使用正则，刻意保留宽松匹配以适应版面微调；任何上游 HTML 变更
//      只会导致返回 0 条结果，不会让上层崩溃。

export interface SearchHit {
  title: string
  snippet: string
  url: string
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 Mobile/15E148"

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&ensp;/g, " ")
    .replace(/&emsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
}

async function fetchText(url: string, timeoutMs = 5000, userAgent = UA): Promise<string> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: ctl.signal,
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(t)
  }
}

function cleanAttribute(s: string): string {
  return stripTags(s).replace(/&amp;/g, "&")
}

function parseSo360(html: string, max: number): SearchHit[] {
  const out: SearchHit[] = []
  const blockRe = /<li[^>]+class="[^"]*\bres-list\b[^"]*"[^>]*>([\s\S]*?)(?=<li[^>]+class="[^"]*\bres-list\b|<\/ol>|$)/gi
  let blockMatch: RegExpExecArray | null
  while ((blockMatch = blockRe.exec(html)) && out.length < max) {
    const block = blockMatch[1]
    const titleMatch = block.match(
      /<h3[^>]+class="[^"]*\bres-title\b[^"]*"[^>]*>[\s\S]*?<a[^>]+data-mdurl="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    )
    if (!titleMatch) continue
    const snippetMatch = block.match(/<p[^>]+class="[^"]*\bres-desc\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
    const url = cleanAttribute(titleMatch[1])
    const title = stripTags(titleMatch[2])
    const snippet = stripTags(snippetMatch?.[1] ?? title)
    if (!/^https?:\/\//i.test(url) || !title) continue
    out.push({ title, snippet, url })
  }
  return out
}

function parseSogou(html: string, max: number): SearchHit[] {
  const out: SearchHit[] = []
  const blockRe = /<div[^>]+class="[^"]*\bvrwrap\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*\bvrwrap\b|<!--\s*ResultListViewEnd|$)/gi
  let blockMatch: RegExpExecArray | null
  while ((blockMatch = blockRe.exec(html)) && out.length < max) {
    const block = blockMatch[1]
    const titleMatch = block.match(
      /<h3[^>]+class="[^"]*\bvr-title\b[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i
    )
    const actualUrlMatch = block.match(/\bdata-url="(https?:\/\/[^"]+)"/i)
    const snippetMatch = block.match(
      /<div[^>]+(?:id="cacheresult_summary_[^"]*"|class="[^"]*(?:fz-mid|str-text-info)[^"]*")[^>]*>([\s\S]*?)<\/div>/i
    )
    if (!titleMatch || !actualUrlMatch) continue
    const url = cleanAttribute(actualUrlMatch[1])
    const title = stripTags(titleMatch[1])
    const snippet = stripTags(snippetMatch?.[1] ?? title)
    if (!title) continue
    out.push({ title, snippet, url })
  }
  return out
}

function parseBing(html: string, max: number): SearchHit[] {
  const out: SearchHit[] = []
  const blockRe =
    /<li class="b_algo"[\s\S]*?<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(html)) && out.length < max) {
    const url = cleanAttribute(match[1])
    const title = stripTags(match[2])
    const snippet = stripTags(match[3])
    if (!/^https?:\/\//i.test(url) || !title) continue
    out.push({ title, snippet, url })
  }
  return out
}

function parseBaiduMobile(html: string, max: number): SearchHit[] {
  const out: SearchHit[] = []
  const resultRe =
    /\bdata-url="(https?:\/\/[^"]+)"[\s\S]{0,2600}?<h3[^>]+class="[^"]*(?:cosc-title|c-title)[^"]*"[^>]*>([\s\S]*?)<\/h3>/gi
  let match: RegExpExecArray | null
  while ((match = resultRe.exec(html)) && out.length < max) {
    const url = cleanAttribute(match[1])
    const title = stripTags(match[2])
    if (!title || !/^https?:\/\//i.test(url)) continue
    out.push({ title, snippet: title, url })
  }
  return out
}

function relevantQueryTerms(query: string): string[] {
  const cleaned = query
    .toLowerCase()
    .replace(
      /怎么|如何|哪家|哪个|哪些|比较|靠谱|推荐|有没有|有那些|有什么|是否|需要|想买|我要|给我|帮我|请问|可以|值得|最好|一下|的|是|了|吗|呢|啊/gu,
      " "
    )
  const terms = new Set<string>()
  for (const chunk of cleaned.match(/[\p{Script=Han}]+/gu) ?? []) {
    if (chunk.length <= 4) {
      if (chunk.length >= 2) terms.add(chunk)
      continue
    }
    for (let i = 0; i < chunk.length - 1; i++) terms.add(chunk.slice(i, i + 2))
  }
  for (const word of cleaned.match(/[a-z0-9][a-z0-9._+-]{2,}/g) ?? []) terms.add(word)
  return Array.from(terms)
}

const SEARCH_KEYWORD_VOCABULARY = [
  "供应商",
  "服务商",
  "生产商",
  "经销商",
  "厂家",
  "品牌",
  "公司",
  "企业",
  "批发",
  "采购",
  "竹笋",
  "笋干",
  "泡发",
  "切片",
  "笋片",
  "火锅",
  "冒菜",
  "餐饮",
  "食品",
  "国产",
  "手机",
  "汽车",
  "软件",
  "平台",
  "系统",
  "工具",
  "价格",
  "质量",
  "口碑",
]

function compactSearchQuery(query: string): string {
  const normalized = query.toLowerCase()
  const terms = SEARCH_KEYWORD_VOCABULARY.filter(term => normalized.includes(term))
  for (const word of normalized.match(/[a-z0-9][a-z0-9._+-]{2,}/g) ?? []) terms.push(word)
  const unique = Array.from(new Set(terms))
  if (unique.length >= 2) return unique.join(" ")
  return query
    .replace(/[？?！!，,。；;：:、“”"'（）()]/g, " ")
    .replace(
      /怎么|如何|哪家|哪个|哪些|比较|靠谱|推荐|有没有|有什么|是否|需要|想买|我要|给我|帮我|请问|可以|值得|最好|一下/gu,
      " "
    )
    .replace(/\s+/g, " ")
    .trim()
}

function isRelevantHit(query: string, hit: SearchHit): boolean {
  const haystack = `${hit.title} ${hit.snippet}`.toLowerCase().replace(/\s+/g, "")
  try {
    const domain = new URL(hit.url).hostname.replace(/^www\./, "").toLowerCase()
    if (["n.cn", "so.com", "sogou.com", "bing.com"].includes(domain)) return false
  } catch {
    return false
  }

  const normalizedQuery = query.toLowerCase().replace(/\s+/g, "")
  if (normalizedQuery.length >= 4 && haystack.includes(normalizedQuery)) return true

  const commercialVocabulary = [
    "供应商",
    "厂家",
    "品牌",
    "公司",
    "企业",
    "批发",
    "采购",
    "服务商",
    "经销商",
    "生产商",
    "商家",
    "商品",
    "货源",
    "工厂",
    "店铺",
  ]
  const hasCommercialIntent = commercialVocabulary.some(term => normalizedQuery.includes(term))
  if (hasCommercialIntent && !commercialVocabulary.some(term => haystack.includes(term))) {
    return false
  }

  const subjectTerms = [
    "竹笋",
    "笋干",
    "泡发",
    "切片",
    "笋片",
    "火锅",
    "冒菜",
    "手机",
    "汽车",
    "软件",
    "平台",
    "系统",
    "工具",
    "餐饮",
    "食品",
  ].filter(term => normalizedQuery.includes(term))
  if (
    subjectTerms.length > 0 &&
    !subjectTerms.some(term => haystack.includes(term))
  ) {
    return false
  }

  const terms = relevantQueryTerms(query)
  if (terms.length === 0) return true
  const matched = terms.filter(term => haystack.includes(term))
  const chineseTerms = terms.filter(term => /[\p{Script=Han}]/u.test(term))
  return chineseTerms.length > 0 ? matched.length >= Math.min(2, chineseTerms.length) : matched.length > 0
}

/**
 * 执行一次网页搜索。返回最多 maxResults 条 {title, snippet, url}。
 * 永不抛出：上游搜索失败时返回 []，并在控制台 warn 一笔。
 */
export async function webSearch(query: string, maxResults = 10): Promise<SearchHit[]> {
  const q = query.trim()
  if (!q) return []
  const compact = compactSearchQuery(q)
  const queries = compact && compact !== q ? [q, compact] : [q]

  const settled = await Promise.all(
    queries.map(async searchQuery => {
      const [so360Result, sogouResult, bingResult, baiduResult] = await Promise.allSettled([
        fetchText(`https://www.so.com/s?q=${encodeURIComponent(searchQuery)}`),
        fetchText(`https://www.sogou.com/web?query=${encodeURIComponent(searchQuery)}`),
        fetchText(
          `https://cn.bing.com/search?q=${encodeURIComponent(searchQuery)}&mkt=zh-CN&ensearch=0`
        ),
        fetchText(
          `https://m.baidu.com/s?word=${encodeURIComponent(searchQuery)}`,
          5000,
          MOBILE_UA
        ),
      ])
      const so360Hits =
        so360Result.status === "fulfilled"
          ? parseSo360(so360Result.value, maxResults).filter(hit => isRelevantHit(q, hit))
          : []
      const sogouHits =
        sogouResult.status === "fulfilled"
          ? parseSogou(sogouResult.value, maxResults).filter(hit => isRelevantHit(q, hit))
          : []
      const bingHits =
        bingResult.status === "fulfilled"
          ? parseBing(bingResult.value, maxResults).filter(hit => isRelevantHit(q, hit))
          : []
      const baiduHits =
        baiduResult.status === "fulfilled"
          ? parseBaiduMobile(baiduResult.value, maxResults).filter(hit => isRelevantHit(q, hit))
          : []
      if (so360Result.status === "rejected") {
        const msg =
          so360Result.reason instanceof Error
            ? so360Result.reason.message
            : String(so360Result.reason)
        console.warn(`[web-search] 360 搜索调用失败：${msg} | q="${searchQuery}"`)
      }
      if (sogouResult.status === "rejected") {
        const msg =
          sogouResult.reason instanceof Error
            ? sogouResult.reason.message
            : String(sogouResult.reason)
        console.warn(`[web-search] 搜狗调用失败：${msg} | q="${searchQuery}"`)
      }
      if (bingResult.status === "rejected") {
        const msg =
          bingResult.reason instanceof Error ? bingResult.reason.message : String(bingResult.reason)
        console.warn(`[web-search] Bing 调用失败：${msg} | q="${searchQuery}"`)
      }
      if (baiduResult.status === "rejected") {
        const msg =
          baiduResult.reason instanceof Error
            ? baiduResult.reason.message
            : String(baiduResult.reason)
        console.warn(`[web-search] 百度移动搜索调用失败：${msg} | q="${searchQuery}"`)
      }
      return { so360Hits, sogouHits, bingHits, baiduHits }
    })
  )

  const sourceLists = settled.flatMap(result => [
    result.so360Hits,
    result.sogouHits,
    result.bingHits,
    result.baiduHits,
  ])
  if (sourceLists.every(hits => hits.length === 0)) {
    console.warn(`[web-search] 中文搜索无相关结果 | q="${q}" | compact="${compact}"`)
  }

  const merged: SearchHit[] = []
  const seen = new Set<string>()
  const maxLen = Math.max(0, ...sourceLists.map(hits => hits.length))
  for (let i = 0; i < maxLen && merged.length < maxResults; i++) {
    for (const hits of sourceLists) {
      const hit = hits[i]
      if (!hit || seen.has(hit.url)) continue
      seen.add(hit.url)
      merged.push(hit)
      if (merged.length >= maxResults) break
    }
  }
  return merged
}

/**
 * 把搜索结果压缩为一段精炼文本喂给 LLM。
 * 每条限制 ~240 字符，整体最多 ~1.5k 字符，避免吃满上下文。
 */
export function formatHitsForLLM(query: string, hits: SearchHit[]): string {
  if (hits.length === 0) {
    return JSON.stringify({ query, public_web_pages: [] })
  }
  return JSON.stringify(
    {
      query,
      public_web_pages: hits.map((h, i) => ({
        index: i + 1,
        title: h.title.slice(0, 100),
        snippet: h.snippet.slice(0, 260),
        url: h.url,
      })),
    },
    null,
    2
  )
}
