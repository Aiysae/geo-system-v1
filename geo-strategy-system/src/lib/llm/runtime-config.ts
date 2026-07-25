import "server-only"

import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import type { ChatArgs } from "@/lib/llm/openai-compat"
import type { AiProviderKey, AiProviderRuntimeSetting } from "@/types/ai-settings"

export async function getChatRuntimeSetting(
  provider: AiProviderKey,
  args: Pick<ChatArgs, "runtimeOverride">,
): Promise<AiProviderRuntimeSetting> {
  const stored = await getAiProviderRuntimeSetting(provider)
  const override = args.runtimeOverride
  if (!override || override.vendor !== provider) return stored

  return {
    ...stored,
    baseUrl: override.baseUrl,
    chatPath: override.chatPath,
    apiKey: override.apiKey,
    model: override.model,
    timeout: override.timeout ?? stored.timeout,
    extra: {
      ...stored.extra,
      ...override.extra,
    },
  }
}
