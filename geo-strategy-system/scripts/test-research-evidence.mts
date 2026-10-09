import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type { SafeWebFetchResult } from "../src/lib/safe-web-fetch"
import type { SearchHit } from "../src/lib/llm/web-search"
import type * as ResearchEvidenceModule from "../src/lib/research/web-evidence"

const require = createRequire(import.meta.url)
const {
  ResearchEvidenceError,
  buildCompetitorSearchQueries,
  buildResearchSearchQueries,
  canonicalizeEvidenceUrl,
  collectResearchEvidence,
  formatResearchEvidenceForModel,
} = require("../src/lib/research/web-evidence.ts") as typeof ResearchEvidenceModule

const researchQueries = buildResearchSearchQueries({
  subject: "测试品牌",
  aliases: ["测试别名"],
  industry: "企业服务",
  region: "杭州",
  website: "https://brand.example.com",
  competitors: ["竞品甲", "竞品乙"],
  hypothesis: "第三方信源不足",
})
assert.ok(researchQueries.length >= 4)
assert.ok(researchQueries.some(query => query.includes("测试品牌")))
assert.ok(researchQueries.some(query => query.includes("site:brand.example.com")))

const competitorQueries = buildCompetitorSearchQueries({
  subject: "测试品牌",
  competitor: "竞品甲",
  industry: "企业服务",
  region: "杭州",
})
assert.equal(competitorQueries.length, 4)
assert.ok(competitorQueries[0].includes("测试品牌"))
assert.ok(competitorQueries[0].includes("竞品甲"))

assert.equal(
  canonicalizeEvidenceUrl("https://example.com/report/?utm_source=test&spm=123#part"),
  "https://example.com/report",
)
assert.equal(canonicalizeEvidenceUrl("javascript:alert(1)"), null)

const hitsByQuery = new Map<string, SearchHit[]>()
for (const [index, query] of researchQueries.entries()) {
  hitsByQuery.set(query, [
    {
      title: `测试品牌行业调研 ${index + 1}`,
      snippet: "这是一段可用于验证网页相关性的搜索摘要，包含品牌、行业和服务信息。",
      url: `https://source${index % 3}.example.com/articles/${index + 1}?utm_source=search`,
    },
    {
      title: "图片资源",
      snippet: "这条结果应被排除。",
      url: "https://img.example.com/assets/logo.png",
    },
  ])
}

function readablePage(url: string): SafeWebFetchResult {
  const articleNumber = new URL(url).pathname.split("/").pop() || "1"
  return {
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    ok: true,
    contentType: "text/html; charset=utf-8",
    headers: { "content-type": "text/html; charset=utf-8" },
    text: `<!doctype html><html><head><title>测试品牌调研报告 ${articleNumber}</title><meta name="description" content="测试品牌公开信息与行业服务资料摘要，用于可审计调研。"></head><body><main>${"公开网页正文内容。".repeat(40)}</main></body></html>`,
    bytes: 500,
    redirects: [],
    durationMs: 5,
  }
}

const bundle = await collectResearchEvidence({
  queries: researchQueries,
  minimumSources: 4,
  minimumDomains: 2,
  maximumSources: 8,
  maximumPerDomain: 2,
  search: async query => hitsByQuery.get(query) || [],
  fetch: async url => readablePage(url),
})

assert.equal(bundle.audit.passed, true)
assert.equal(bundle.audit.searchExecuted, true)
assert.equal(bundle.sources.length, 6)
assert.equal(bundle.audit.uniqueDomainCount, 3)
assert.deepEqual(bundle.sources.map(source => source.id), ["S1", "S2", "S3", "S4", "S5", "S6"])
assert.equal(bundle.sources.some(source => source.url.endsWith(".png")), false)
assert.ok(bundle.sources.every(source => !source.url.includes("utm_source")))
const formatted = formatResearchEvidenceForModel(bundle)
assert.match(formatted, /\[S1\]/)
assert.match(formatted, /URL: https:\/\/source/)
assert.match(formatted, /网页摘录:/)

let insufficientError: unknown
try {
  await collectResearchEvidence({
    queries: ["没有结果的查询"],
    minimumSources: 2,
    minimumDomains: 2,
    search: async () => [],
    fetch: async url => readablePage(url),
  })
} catch (error) {
  insufficientError = error
}
assert.ok(insufficientError instanceof ResearchEvidenceError)
assert.equal(insufficientError.audit.passed, false)
assert.equal(insufficientError.audit.searchExecuted, true)
assert.match(insufficientError.message, /未达到生成可审计报告的最低标准/)

console.log("research evidence regression tests passed")
