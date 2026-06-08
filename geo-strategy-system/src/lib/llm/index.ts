import { chatDoubao, isDoubaoConfigured } from "./doubao"
import { chatDeepSeek, isDeepSeekConfigured } from "./deepseek"
import { chatQwen, isQwenConfigured } from "./qwen"
import { chatKimi, isKimiConfigured } from "./kimi"
import { chatErnie, isErnieConfigured } from "./ernie"
import { chatHunyuan, isHunyuanConfigured } from "./hunyuan"
import type { ChatArgs } from "./openai-compat"
import type { ModelKey } from "@/types"
import { MODEL_LABELS } from "@/lib/model-labels"

interface Adapter {
  label: string
  chat: (args: ChatArgs) => Promise<string>
  configured: () => Promise<boolean>
}

export const ADAPTERS: Record<ModelKey, Adapter> = {
  doubao: { label: MODEL_LABELS.doubao, chat: chatDoubao, configured: isDoubaoConfigured },
  deepseek: { label: MODEL_LABELS.deepseek, chat: chatDeepSeek, configured: isDeepSeekConfigured },
  qwen: { label: MODEL_LABELS.qwen, chat: chatQwen, configured: isQwenConfigured },
  kimi: { label: MODEL_LABELS.kimi, chat: chatKimi, configured: isKimiConfigured },
  ernie: { label: MODEL_LABELS.ernie, chat: chatErnie, configured: isErnieConfigured },
  hunyuan: { label: MODEL_LABELS.hunyuan, chat: chatHunyuan, configured: isHunyuanConfigured },
}

export { MODEL_LABELS }
