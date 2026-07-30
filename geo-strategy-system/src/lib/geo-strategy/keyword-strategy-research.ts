import "server-only"

import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import {
  hasAdapterCredentialPoolCandidate,
  runAdapterCredentialPoolChat,
} from "@/lib/ai-credential-adapter"
import type { SearchSourceEvent } from "@/lib/llm/openai-compat"
import type {
  KeywordStrategyGenerationSettings,
  KeywordStrategyResearchAudit,
} from "@/types/geo-strategy"
import {
  buildKeywordResearchPrompt,
  buildResearchAudit,
} from "./keyword-strategy-methodology"

export async function isKeywordStrategyWebReady(): Promise<boolean> {
  const strictArgs = {
    forceWebSearch: true,
    requireWebEvidence: true,
    officialWebOnly: true,
  } as const
  if (await hasAdapterCredentialPoolCandidate("doubao", "keywordStrategy", strictArgs)) {
    return true
  }
  const config = await getAiProviderRuntimeSetting("doubao")
  return Boolean(config.apiKey && config.model)
}

export async function researchKeywordStrategyContext(input: {
  profile: Record<string, unknown>
  settings: KeywordStrategyGenerationSettings
  signal?: AbortSignal
}): Promise<KeywordStrategyResearchAudit> {
  const config = await getAiProviderRuntimeSetting("doubao")
  const prompt = buildKeywordResearchPrompt({
    profile: input.profile,
    settings: input.settings,
  })
  let searchEvent: SearchSourceEvent | undefined

  const raw = await runAdapterCredentialPoolChat("doubao", "keywordStrategy", {
    system: prompt.system,
    user: prompt.user,
    temperature: 0.15,
    maxTokens: 4096,
    jsonMode: true,
    timeoutSec: Math.min(300, Math.max(90, config.timeout || 240)),
    forceWebSearch: true,
    requireWebEvidence: true,
    officialWebOnly: true,
    allowWebSearch: true,
    signal: input.signal,
    onSearchSources: event => {
      searchEvent = event
    },
  })

  const audit = buildResearchAudit({
    model: config.model,
    settings: input.settings,
    query: prompt.user,
    raw,
    event: searchEvent,
  })
  if (!audit.search_executed) {
    throw new Error("豆包联网研究没有检测到官方联网搜索执行记录。")
  }
  if (!audit.provider_request_id) {
    throw new Error("豆包联网研究没有返回可审计请求编号。")
  }
  if (audit.sources.length === 0) {
    throw new Error("豆包联网研究没有返回可打开的网页来源。")
  }
  return audit
}
