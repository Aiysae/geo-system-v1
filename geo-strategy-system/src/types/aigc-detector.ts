// ============ AIGC 检测器 - 类型定义 ============

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
