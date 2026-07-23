import assert from "node:assert/strict"
import type { GeoAuditResource } from "../src/types"
import type { SafeWebFetchResult } from "../src/lib/safe-web-fetch"

const { validatePublicHttpUrl } = await import("../src/lib/safe-web-fetch")
const { analyzeAuditPage } = await import("../src/lib/geo-audit/page-analysis")
const {
  parseRobots,
  parseSitemapXml,
  validateLlmsText,
} = await import("../src/lib/geo-audit/resource-parsers")
const { scoreWebsiteAudit } = await import("../src/lib/geo-audit/scoring")

await assert.rejects(() => validatePublicHttpUrl("http://127.0.0.1/private"), /内网或保留地址/)
await assert.rejects(() => validatePublicHttpUrl("http://[::1]/private"), /内网或保留地址/)
await assert.rejects(() => validatePublicHttpUrl("file:///etc/passwd"), /http 或 https/)

const robotsText = [
  "User-agent: *",
  "Allow: /",
  "",
  "User-agent: OAI-SearchBot",
  "Allow: /",
  "",
  "User-agent: GPTBot",
  "Disallow: /",
  "",
  "Sitemap: https://example.com/sitemap.xml",
].join("\n")
const robots = parseRobots(
  "https://example.com/robots.txt",
  robotsText,
  "https://example.com/",
  "available",
)
assert.equal(robots.policies.find(item => item.key === "oaiSearch")?.status, "allowed")
assert.equal(robots.policies.find(item => item.key === "oaiSearch")?.explicit, true)
assert.equal(robots.policies.find(item => item.key === "gptBot")?.status, "blocked")
assert.deepEqual(robots.sitemapUrls, ["https://example.com/sitemap.xml"])

const sitemap = parseSitemapXml(`<?xml version="1.0"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://example.com/</loc></url>
    <url><loc>https://example.com/about</loc></url>
  </urlset>`)
assert.equal(sitemap.valid, true)
assert.equal(sitemap.pageUrls.length, 2)
assert.equal(validateLlmsText(
  "# Example\n\n> Site summary for AI systems and search assistants.\n\n## Docs\n- [About](https://example.com/about): Company identity, services and contact information.",
).valid, true)

const goodHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <title>势途 GEO 全链路操作工具</title>
    <meta name="description" content="面向企业的 GEO 分析、诊断和内容执行工具。">
    <link rel="canonical" href="https://example.com/">
    <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@graph":[
          {"@type":"Organization","name":"势途","url":"https://example.com/"},
          {"@type":"WebSite","name":"势途 GEO"},
          {"@type":"FAQPage","mainEntity":[]},
          {"@type":"BreadcrumbList","itemListElement":[]}
        ]
      }
    </script>
  </head>
  <body>
    <header><nav><a href="/about">关于我们</a><a href="/service">服务</a><a href="/faq">常见问题</a></nav></header>
    <main>
      <article>
        <h1>势途 GEO 全链路操作工具</h1>
        <p>势途 GEO 帮助企业诊断网站的 AI 可见性，并根据真实证据制定内容与技术优化方案。</p>
        <h2>网站为什么需要 GEO 诊断？</h2>
        <p>诊断会检查抓取协议、标题结构、实体标记和内容可信度。</p>
        <h2>如何提升 AI 可读性？</h2>
        <p>先修复访问问题，再完善问答、结构化数据和可信来源。</p>
        <h2>常见问题</h2>
        <h3>报告是否包含具体证据？</h3>
        <p>是，报告会保留受影响页面和检查依据。</p>
        <p>作者：势途 GEO 专业团队，内容已经审核并引用公开标准。</p>
        <a href="https://www.rfc-editor.org/rfc/rfc9309.html">Robots 标准</a>
      </article>
    </main>
    <footer><a href="/contact">联系我们</a><a href="/privacy">隐私条款</a></footer>
  </body>
</html>`

const result: SafeWebFetchResult = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  ok: true,
  contentType: "text/html; charset=utf-8",
  headers: {},
  text: goodHtml,
  bytes: Buffer.byteLength(goodHtml),
  redirects: [],
  durationMs: 120,
}
const goodPage = analyzeAuditPage(result).page
assert.deepEqual(goodPage.h1, ["势途 GEO 全链路操作工具"])
assert.equal(goodPage.visibleQuestionCount >= 3, true)
assert.equal(goodPage.structuredDataTypes.includes("Organization"), true)
assert.equal(goodPage.jsShellRisk, false)

const duplicateHeadingPage = analyzeAuditPage({
  ...result,
  text: "<html lang='zh-CN'><head><title>重复标题测试</title></head><body><main><h1>同一标题</h1><h1>同一标题</h1><p>这是用于验证重复 H1 不能被去重隐藏的完整页面说明。</p></main></body></html>",
}).page
assert.equal(duplicateHeadingPage.h1.length, 2)

const resources: GeoAuditResource[] = [
  {
    kind: "robots",
    url: "https://example.com/robots.txt",
    status: 200,
    available: true,
    valid: true,
    summary: "robots.txt 有效",
  },
  {
    kind: "sitemap",
    url: "https://example.com/sitemap.xml",
    status: 200,
    available: true,
    valid: true,
    summary: "Sitemap 有效",
  },
  {
    kind: "llms",
    url: "https://example.com/llms.txt",
    status: 200,
    available: true,
    valid: true,
    summary: "llms.txt 有效",
  },
]
const goodScore = scoreWebsiteAudit({
  expectedEntityName: "势途",
  pages: [goodPage, goodPage, goodPage, goodPage, goodPage],
  resources,
  botPolicies: robots.policies,
})
assert.equal(goodScore.dimensions.reduce((sum, item) => sum + item.maxScore, 0), 100)
assert.equal(goodScore.score >= 75, true)

const poorResult: SafeWebFetchResult = {
  ...result,
  text: "<!doctype html><html><head><title>首页</title></head><body><div id='app'></div><script></script><script></script><script></script><script></script></body></html>",
  bytes: 150,
}
const poorPage = analyzeAuditPage(poorResult).page
const blockedRobots = parseRobots(
  "https://example.com/robots.txt",
  "User-agent: *\nDisallow: /\nUser-agent: OAI-SearchBot\nDisallow: /",
  "https://example.com/",
  "available",
)
const poorScore = scoreWebsiteAudit({
  expectedEntityName: "势途",
  pages: [poorPage],
  resources: resources.map(resource => ({
    ...resource,
    available: resource.kind === "robots",
    valid: resource.kind === "robots",
  })),
  botPolicies: blockedRobots.policies,
})
assert.equal(poorPage.jsShellRisk, true)
assert.equal(poorScore.score < goodScore.score, true)
assert.equal(poorScore.checks.find(check => check.id === "robots-oai-search")?.priority, "P0")

console.log("website GEO audit tests passed")
