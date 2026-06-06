import { chatDoubao, isDoubaoConfigured } from "./doubao"
import { chatDeepSeek, isDeepSeekConfigured } from "./deepseek"
import { chatQwen, isQwenConfigured } from "./qwen"
import { chatKimi, isKimiConfigured } from "./kimi"
import { chatErnie, isErnieConfigured } from "./ernie"
import { chatHunyuan, isHunyuanConfigured } from "./hunyuan"
import type { ChatArgs } from "./openai-compat"
import type { ModelKey } from "@/types"

interface Adapter {
  label: string
  chat: (args: ChatArgs) => Promise<string>
  configured: () => boolean
}

export const ADAPTERS: Record<ModelKey, Adapter> = {
  doubao: { label: "豆包", chat: chatDoubao, configured: isDoubaoConfigured },
  deepseek: { label: "DeepSeek", chat: chatDeepSeek, configured: isDeepSeekConfigured },
  qwen: { label: "通义千问", chat: chatQwen, configured: isQwenConfigured },
  kimi: { label: "Kimi", chat: chatKimi, configured: isKimiConfigured },
  ernie: { label: "文心一言", chat: chatErnie, configured: isErnieConfigured },
  hunyuan: { label: "腾讯元宝/混元", chat: chatHunyuan, configured: isHunyuanConfigured },
}

export const MODEL_LABELS: Record<ModelKey, string> = {
  doubao: "豆包",
  deepseek: "DeepSeek",
  qwen: "通义千问",
  kimi: "Kimi",
  ernie: "文心一言",
  hunyuan: "腾讯元宝/混元",
}
