import type { ModelKey, PenetrationSource } from "../src/types"

const question = process.env.PENETRATION_SMOKE_QUESTION?.trim()
  || "今天是几月几日？请依据当前公开网页信息直接回答。"
const requestedModels = (process.env.PENETRATION_SMOKE_MODELS || "doubao,deepseek,qwen,kimi,ernie,hunyuan")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean) as ModelKey[]

const { ADAPTERS } = await import("../src/lib/llm")
const { isAuditableSourceUrl } = await import("../src/lib/llm/source-extract")
const { getPenetrationModelReadiness } = await import("../src/lib/penetration/model-readiness")

type SmokeResult = {
  model: ModelKey
  configured: boolean
  eligible: boolean
  ok: boolean
  answerLength: number
  sourceCount: number
  requestIdCount: number
  searchExecuted: boolean
  attempts: number
  elapsedMs: number
  error?: string
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/bce-v3\/[A-Za-z0-9_\-/]+/g, "bce-v3/***")
    .replace(/Bearer\s+[A-Za-z0-9._\-/]{16,}/gi, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/\s+/g, " ")
    .slice(0, 300)
}

async function probe(model: ModelKey): Promise<SmokeResult> {
  const adapter = ADAPTERS[model]
  const started = Date.now()
  const configured = await adapter.configured().catch(() => false)
  const readiness = await getPenetrationModelReadiness(model).catch(error => ({
    model,
    ready: false,
    reason: safeError(error),
  }))
  if (!configured) {
    return {
      model,
      configured,
      eligible: false,
      ok: false,
      answerLength: 0,
      sourceCount: 0,
      requestIdCount: 0,
      searchExecuted: false,
      attempts: 0,
      elapsedMs: Date.now() - started,
      error: "not configured",
    }
  }
  if (!readiness.ready) {
    return {
      model,
      configured,
      eligible: false,
      ok: true,
      answerLength: 0,
      sourceCount: 0,
      requestIdCount: 0,
      searchExecuted: false,
      attempts: 0,
      elapsedMs: Date.now() - started,
      error: `skipped: ${readiness.reason || "strict web unavailable"}`,
    }
  }

  let lastError = "strict web probe failed"
  for (let attempt = 1; attempt <= 3; attempt++) {
    const sources: PenetrationSource[] = []
    const requestIds = new Set<string>()
    let searchExecuted = false
    try {
      const answer = await adapter.chat({
        system: "",
        user: question,
        temperature: 0,
        maxTokens: 1024,
        seed: (Date.now() + attempt) % 2_147_483_647,
        mode: "consumer",
        jsonMode: false,
        timeoutSec: 180,
        forceWebSearch: true,
        rawQuestionOnly: true,
        requireWebEvidence: true,
        officialWebOnly: true,
        onSearchSources: event => {
          searchExecuted ||= event.searchExecuted === true
          sources.push(...event.sources)
          if (event.providerRequestId?.trim()) requestIds.add(event.providerRequestId.trim())
        },
      })
      const auditableSources = sources.filter(source =>
        isAuditableSourceUrl(source.url, source.title, source.snippet),
      )
      const ok =
        answer.trim().length > 0
        && searchExecuted
        && auditableSources.length > 0
        && requestIds.size > 0
      if (ok || attempt === 3) {
        return {
          model,
          configured,
          eligible: true,
          ok,
          answerLength: answer.trim().length,
          sourceCount: auditableSources.length,
          requestIdCount: requestIds.size,
          searchExecuted,
          attempts: attempt,
          elapsedMs: Date.now() - started,
          ...(ok ? {} : { error: lastError }),
        }
      }
      lastError = "answer did not include complete auditable web evidence"
    } catch (error) {
      lastError = safeError(error)
      if (attempt === 3) {
        return {
          model,
          configured,
          eligible: true,
          ok: false,
          answerLength: 0,
          sourceCount: 0,
          requestIdCount: 0,
          searchExecuted,
          attempts: attempt,
          elapsedMs: Date.now() - started,
          error: lastError,
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 2_000 : 5_000))
  }

  throw new Error("unreachable")
}

const results: SmokeResult[] = []
for (const model of requestedModels) {
  if (!(model in ADAPTERS)) continue
  results.push(await probe(model))
}

console.table(results)
if (results.some(result => result.eligible && !result.ok)) process.exitCode = 1
