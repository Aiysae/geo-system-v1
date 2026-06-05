// ============ AIGC 检测器 - 类型定义 ============

/** LLM 调用模式 */
export type LlmMode = "consumer" | "judge"

/** API 供应商配置 */
export interface ApiProviderConfig {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
  chatPath: string
}

/** 检测分析结果 */
export interface AnalysisResult {
  aigcScore: number
  marketingScore: number
  approvalScore: number
  aigcFeatures: string[]
  marketingIssues: string[]
  approvalRisks: string[]
  overallSuggestion: string
}

/** 优化选项 */
export interface OptimizeOptions {
  reduceAigc: boolean
  reduceMarketing: boolean
  improveApproval: boolean
  preserveCore: boolean
  aigcIntensity: "light" | "medium" | "aggressive"
  useSlang: boolean
  addPersonalStory: boolean
  marketingIntensity: "light" | "medium" | "aggressive"
  removeBrandMention: boolean
  removeCTA: boolean
  addObjectiveView: boolean
}

/** 优化请求 */
export interface OptimizeRequest {
  content: string
  options: OptimizeOptions
  analysisResult: AnalysisResult
  apiConfig: ApiSettings
}

/** 检测请求 */
export interface AnalyzeRequest {
  content: string
  apiConfig: ApiSettings
}

/** API 设置 */
export interface ApiSettings {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
}

/** 优化结果 */
export interface OptimizeResult {
  optimizedContent: string
  changes: string[]
}

/** API 供应商列表 */
export const API_PROVIDERS: ApiProviderConfig[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com", defaultModel: "gpt-4o-mini", chatPath: "/v1/chat/completions" },
  { id: "bai", label: "B.AI", baseUrl: "https://api.b.ai", defaultModel: "gpt-4o-mini", chatPath: "/v1/chat/completions" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-chat", chatPath: "/v1/chat/completions" },
  { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com", defaultModel: "claude-sonnet-4-6", chatPath: "/v1/messages" },
  { id: "dashscope", label: "通义千问 DashScope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode", defaultModel: "qwen3-vl-plus", chatPath: "/v1/chat/completions" },
  { id: "moonshot", label: "Moonshot Kimi", baseUrl: "https://api.moonshot.cn", defaultModel: "moonshot-v1-8k", chatPath: "/v1/chat/completions" },
  { id: "glm", label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas", defaultModel: "glm-4v", chatPath: "/v4/chat/completions" },
  { id: "siliconflow", label: "硅基流动", baseUrl: "https://api.siliconflow.cn", defaultModel: "Qwen/Qwen2.5-VL-72B-Instruct", chatPath: "/v1/chat/completions" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api", defaultModel: "openai/gpt-4o-mini", chatPath: "/v1/chat/completions" },
  { id: "custom", label: "自定义(OpenAI兼容)", baseUrl: "", defaultModel: "", chatPath: "/v1/chat/completions" },
]
