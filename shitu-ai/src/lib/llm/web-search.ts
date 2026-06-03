// 轻量级网页搜索：用于给"不带联网"的大模型（如 DeepSeek）做 Tool Calling 外挂。
//
// 设计取舍：
//   - 零依赖（不引入 duckduckgo-search / cheerio / playwright 等）。
//   - 优先 DuckDuckGo HTML 端点，失败则降级 Bing 中文站。
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

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
}

async function fetchText(url: string, timeoutMs = 8000): Promise<string> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: ctl.signal,
      headers: {
        "User-Agent": UA,
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

function parseDuckDuckGo(html: string, max: number): SearchHit[] {
  const out: SearchHit[] = []
  const blockRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) && out.length < max) {
    const rawUrl = m[1]
    const title = stripTags(m[2])
    const snippet = stripTags(m[3])
    if (!title || !snippet) continue
    // DDG 的链接通常是 /l/?uddg=<encoded> 的跳转，做一次解码
    let url = rawUrl
    const ud = rawUrl.match(/[?&]uddg=([^&]+)/)
    if (ud) {
      try {
        url = decodeURIComponent(ud[1])
      } catch {
        /* 保持原值 */
      }
    }
    out.push({ title, snippet, url })
  }
  return out
}

function parseBing(html: string, max: number): SearchHit[] {
  const out: SearchHit[] = []
  const blockRe = /<li class="b_algo"[\s\S]*?<h2>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) && out.length < max) {
    const url = m[1]
    const title = stripTags(m[2])
    const snippet = stripTags(m[3])
    if (!title || !snippet) continue
    out.push({ title, snippet, url })
  }
  return out
}

/**
 * 执行一次网页搜索。返回最多 maxResults 条 {title, snippet, url}。
 * 永不抛出：上游搜索失败时返回 []，并在控制台 warn 一笔。
 */
export async function webSearch(query: string, maxResults = 5): Promise<SearchHit[]> {
  const q = query.trim()
  if (!q) return []

  // 1) DuckDuckGo HTML
  try {
    const html = await fetchText(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=cn-zh`
    )
    const hits = parseDuckDuckGo(html, maxResults)
    if (hits.length > 0) return hits
    console.warn(`[web-search] DuckDuckGo 返回 0 条，降级 Bing | q="${q}"`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[web-search] DuckDuckGo 调用失败：${msg}，降级 Bing | q="${q}"`)
  }

  // 2) Bing 中文站
  try {
    const html = await fetchText(
      `https://www.bing.com/search?q=${encodeURIComponent(q)}&mkt=zh-CN`
    )
    const hits = parseBing(html, maxResults)
    if (hits.length === 0) {
      console.warn(`[web-search] Bing 也返回 0 条 | q="${q}"`)
    }
    return hits
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[web-search] Bing 调用失败：${msg} | q="${q}"`)
    return []
  }
}

/**
 * 把搜索结果压缩为一段精炼文本喂给 LLM。
 * 每条限制 ~240 字符，整体最多 ~1.5k 字符，避免吃满上下文。
 */
export function formatHitsForLLM(query: string, hits: SearchHit[]): string {
  if (hits.length === 0) {
    return `(搜索 "${query}" 未取到任何网页结果，请基于既有知识谨慎作答；若不确定请明说 "不了解"。)`
  }
  const lines: string[] = [`关于 "${query}" 的实时网页搜索结果 (Top ${hits.length})：`]
  hits.forEach((h, i) => {
    const title = h.title.slice(0, 80)
    const snippet = h.snippet.slice(0, 200)
    lines.push(`【${i + 1}】${title}\n  摘要: ${snippet}\n  来源: ${h.url}`)
  })
  return lines.join("\n")
}
