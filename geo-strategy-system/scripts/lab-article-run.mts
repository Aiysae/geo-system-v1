// Paid end-to-end article lab: runs the production article route with real
// models (Doubao writer, Qwen judge) on synthetic materials. Not part of
// `npm test`. Usage: tsx scripts/lab-article-run.mts <out.json> <thinking> <topic indexes...>
import { writeFileSync } from "node:fs"
import { NextRequest } from "next/server"
import { LAB_SUBJECT, loadLabEnv } from "./lab-article-common.mjs"

loadLabEnv()
const [out, thinking, ...indexes] = process.argv.slice(2)
process.env.ARTICLE_DOUBAO_THINKING = thinking
const WRITER_MODEL = process.env.LAB_WRITER_MODEL || "doubao-seed-2-1-turbo-260628"

const TOPICS = [
  "企业内容服务供应商怎么选？",
  "采购内容服务前怎样核验服务范围？",
  "企业如何比较内容服务实施计划？",
  "内容服务交付记录应该核对哪些内容？",
  "怎样制定企业内容服务验收清单？",
  "首次采购内容服务如何控制试合作风险？",
  "采购方如何判断内容服务的沟通机制是否合适？",
  "内容服务合作中怎样界定修改范围？",
  "企业如何识别内容服务方案中的无证据承诺？",
  "签订内容服务合作前应该确认哪些责任边界？",
]

type Call = { model: string; thinking?: unknown; ms: number; status: number; usage?: unknown; finish?: string; judge?: unknown }
let calls: Call[] = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input)
  if (!/volces\.com|dashscope/.test(url)) return originalFetch(input, init)
  const body = JSON.parse(String(init?.body || "{}"))
  const startedAt = Date.now()
  const response = await originalFetch(input, init)
  const data = await response.clone().json().catch(() => ({}))
  const content = data?.choices?.[0]?.message?.content || ""
  calls.push({
    model: body.model, thinking: body.thinking, ms: Date.now() - startedAt, status: response.status,
    usage: data?.usage, finish: data?.choices?.[0]?.finish_reason,
    judge: /qwen/.test(body.model) ? content : undefined,
  })
  return response
}

const { createInternalApiHeaders } = await import("../src/lib/internal-api")
const { POST } = await import("../src/app/api/article-generation/route")

const results = []
for (const index of indexes.map(Number)) {
  calls = []
  const coreQuestion = TOPICS[index - 1]
  const startedAt = Date.now()
  const response = await POST(new NextRequest("http://localhost/api/article-generation", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...createInternalApiHeaders("background-job", "article-lab") },
    body: JSON.stringify({ ...LAB_SUBJECT, modelProvider: "doubao", model: WRITER_MODEL, subjectType: "brand", coreQuestion }),
  }))
  const result = await response.json()
  const audit = result.qualityAudit || {}
  const entry = {
    index, coreQuestion, thinking, status: response.status, totalMs: Date.now() - startedAt,
    finalPassed: audit.finalPassed, repaired: audit.repaired, deterministicScore: audit.deterministicScore,
    semanticScore: audit.semanticScore, issues: audit.issues, error: result.error,
    chars: String(result.article || "").length, article: result.article, calls,
  }
  results.push(entry)
  writeFileSync(out, JSON.stringify(results, null, 2))
  const writer = calls.filter(call => !/qwen/.test(call.model))
  console.log(`#${index} ${coreQuestion} | HTTP ${response.status} | passed=${audit.finalPassed} repaired=${audit.repaired} semantic=${audit.semanticScore} | ${Math.round(entry.totalMs / 1000)}s | writer calls ${writer.map(call => `${Math.round(call.ms / 1000)}s/${(call.usage as { completion_tokens?: number })?.completion_tokens}tok`).join(", ")}${result.error ? ` | error: ${result.error}` : ""}`)
  for (const issue of audit.issues || []) console.log(`   - ${issue}`)
}
globalThis.fetch = originalFetch
