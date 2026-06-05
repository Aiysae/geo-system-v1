"use client"

import { useState, useCallback } from "react"
import { cn } from "@/lib/utils"
import { API_PROVIDERS } from "@/types"
import type { AnalysisResult, OptimizeOptions, ApiSettings, OptimizeResult } from "@/types"
import {
  Settings,
  Search,
  Sparkles,
  AlertTriangle,
  CheckCircle,
  Copy,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Bot,
  Megaphone,
  Shield,
  Loader2,
  FileText,
} from "lucide-react"

type Status = "idle" | "analyzing" | "optimizing" | "done" | "error"

export default function AigcDetectorPage() {
  const [content, setContent] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState("")
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showOptimizePanel, setShowOptimizePanel] = useState(false)
  const [copied, setCopied] = useState(false)

  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("aigc-detector-api-settings")
      if (saved) {
        try {
          return JSON.parse(saved)
        } catch {
          // ignore
        }
      }
    }
    return {
      provider: "deepseek",
      apiKey: "",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
    }
  })

  const [optimizeOptions, setOptimizeOptions] = useState<OptimizeOptions>({
    reduceAigc: true,
    reduceMarketing: true,
    improveApproval: true,
    preserveCore: true,
    aigcIntensity: "medium",
    useSlang: false,
    addPersonalStory: true,
    marketingIntensity: "medium",
    removeBrandMention: true,
    removeCTA: true,
    addObjectiveView: true,
  })

  const saveApiSettings = useCallback((settings: ApiSettings) => {
    setApiSettings(settings)
    if (typeof window !== "undefined") {
      localStorage.setItem("aigc-detector-api-settings", JSON.stringify(settings))
    }
  }, [])

  const handleAnalyze = async () => {
    if (!content.trim()) {
      setError("请输入待检测的文章内容")
      return
    }
    if (!apiSettings.apiKey) {
      setError("请先配置 API Key")
      setShowSettings(true)
      return
    }

    setStatus("analyzing")
    setError("")
    setAnalysisResult(null)
    setOptimizeResult(null)

    try {
      const res = await fetch("/api/aigc-detector?action=analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, apiConfig: apiSettings }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "检测失败")
      }
      setAnalysisResult(data)
      setStatus("done")
      setShowOptimizePanel(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "检测失败")
      setStatus("error")
    }
  }

  const handleOptimize = async () => {
    if (!analysisResult) return

    setStatus("optimizing")
    setError("")
    setOptimizeResult(null)

    try {
      const res = await fetch("/api/aigc-detector?action=optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          options: optimizeOptions,
          analysisResult,
          apiConfig: apiSettings,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "优化失败")
      }
      setOptimizeResult(data)
      setStatus("done")
    } catch (err) {
      setError(err instanceof Error ? err.message : "优化失败")
      setStatus("error")
    }
  }

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleUseOptimized = () => {
    if (optimizeResult) {
      setContent(optimizeResult.optimizedContent)
      setAnalysisResult(null)
      setOptimizeResult(null)
      setStatus("idle")
    }
  }

  const getScoreColor = (score: number, inverse = false) => {
    const effectiveScore = inverse ? 100 - score : score
    if (effectiveScore >= 70) return "text-green-600"
    if (effectiveScore >= 40) return "text-yellow-600"
    return "text-red-600"
  }

  const getScoreBgColor = (score: number, inverse = false) => {
    const effectiveScore = inverse ? 100 - score : score
    if (effectiveScore >= 70) return "bg-green-500"
    if (effectiveScore >= 40) return "bg-yellow-500"
    return "bg-red-500"
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <FileText className="w-6 h-6 text-[#004B73]" />
              AIGC 内容检测与优化
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              检测文章 AI 生成率、营销性质，评估平台审核通过率
            </p>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg transition-all",
              showSettings
                ? "bg-[#004B73] text-white"
                : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
            )}
          >
            <Settings className="w-4 h-4" />
            API 设置
          </button>
        </div>

        {/* API Settings Panel */}
        {showSettings && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 shadow-sm animate-fade-in-up">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">API 配置</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  API 供应商
                </label>
                <select
                  value={apiSettings.provider}
                  onChange={(e) => {
                    const provider = API_PROVIDERS.find((p) => p.id === e.target.value)
                    saveApiSettings({
                      ...apiSettings,
                      provider: e.target.value,
                      baseUrl: provider?.baseUrl || "",
                      model: provider?.defaultModel || "",
                    })
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#004B73]/20 focus:border-[#004B73]"
                >
                  {API_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiSettings.apiKey}
                  onChange={(e) =>
                    saveApiSettings({ ...apiSettings, apiKey: e.target.value })
                  }
                  placeholder="输入 API Key"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#004B73]/20 focus:border-[#004B73]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Base URL
                </label>
                <input
                  type="text"
                  value={apiSettings.baseUrl}
                  onChange={(e) =>
                    saveApiSettings({ ...apiSettings, baseUrl: e.target.value })
                  }
                  placeholder="https://api.example.com"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#004B73]/20 focus:border-[#004B73]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  模型
                </label>
                <input
                  type="text"
                  value={apiSettings.model}
                  onChange={(e) =>
                    saveApiSettings({ ...apiSettings, model: e.target.value })
                  }
                  placeholder="gpt-4o-mini"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#004B73]/20 focus:border-[#004B73]"
                />
              </div>
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-800">待检测文章</h3>
            <span className="text-sm text-slate-400">
              {content.length} 字
            </span>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="粘贴或输入待检测的文章内容..."
            className="w-full h-64 px-4 py-3 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-[#004B73]/20 focus:border-[#004B73] text-slate-700"
          />
          {error && (
            <div className="mt-3 flex items-center gap-2 text-red-600 text-sm">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleAnalyze}
              disabled={status === "analyzing" || status === "optimizing"}
              className={cn(
                "flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all",
                status === "analyzing" || status === "optimizing"
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                  : "bg-gradient-to-r from-[#004B73] to-[#0077B6] text-white hover:shadow-lg hover:shadow-blue-300/40"
              )}
            >
              {status === "analyzing" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  检测中...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  开始检测
                </>
              )}
            </button>
          </div>
        </div>

        {/* Analysis Result */}
        {analysisResult && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 shadow-sm animate-fade-in-up">
            <h3 className="text-lg font-semibold text-slate-800 mb-6">检测结果</h3>

            {/* Score Cards */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              {/* AIGC Score */}
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Bot className="w-5 h-5 text-purple-600" />
                  <span className="font-medium text-slate-700">AIGC 率</span>
                </div>
                <div className={cn("text-3xl font-bold mb-2", getScoreColor(analysisResult.aigcScore, true))}>
                  {analysisResult.aigcScore}%
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", getScoreBgColor(analysisResult.aigcScore, true))}
                    style={{ width: `${analysisResult.aigcScore}%` }}
                  />
                </div>
                <div className={cn("text-sm mt-2", getScoreColor(analysisResult.aigcScore, true))}>
                  {analysisResult.aigcScore < 30 ? "自然度良好" : analysisResult.aigcScore < 60 ? "有 AI 痕迹" : "明显 AI 生成"}
                </div>
              </div>

              {/* Marketing Score */}
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Megaphone className="w-5 h-5 text-orange-600" />
                  <span className="font-medium text-slate-700">营销性质</span>
                </div>
                <div className={cn("text-3xl font-bold mb-2", getScoreColor(analysisResult.marketingScore, true))}>
                  {analysisResult.marketingScore}%
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", getScoreBgColor(analysisResult.marketingScore, true))}
                    style={{ width: `${analysisResult.marketingScore}%` }}
                  />
                </div>
                <div className={cn("text-sm mt-2", getScoreColor(analysisResult.marketingScore, true))}>
                  {analysisResult.marketingScore < 30 ? "客观中立" : analysisResult.marketingScore < 60 ? "有推广倾向" : "软文明显"}
                </div>
              </div>

              {/* Approval Score */}
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-5 h-5 text-green-600" />
                  <span className="font-medium text-slate-700">审核通过率</span>
                </div>
                <div className={cn("text-3xl font-bold mb-2", getScoreColor(analysisResult.approvalScore))}>
                  {analysisResult.approvalScore}%
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", getScoreBgColor(analysisResult.approvalScore))}
                    style={{ width: `${analysisResult.approvalScore}%` }}
                  />
                </div>
                <div className={cn("text-sm mt-2", getScoreColor(analysisResult.approvalScore))}>
                  {analysisResult.approvalScore >= 70 ? "良好" : analysisResult.approvalScore >= 40 ? "一般" : "较差"}
                </div>
              </div>
            </div>

            {/* Issue Details */}
            <div className="space-y-4">
              {analysisResult.aigcFeatures.length > 0 && (
                <div className="bg-purple-50 rounded-lg p-4">
                  <h4 className="font-medium text-purple-800 mb-2 flex items-center gap-2">
                    <Bot className="w-4 h-4" />
                    AIGC 特征
                  </h4>
                  <ul className="text-sm text-purple-700 space-y-1">
                    {analysisResult.aigcFeatures.map((f, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-purple-400 mt-0.5">•</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysisResult.marketingIssues.length > 0 && (
                <div className="bg-orange-50 rounded-lg p-4">
                  <h4 className="font-medium text-orange-800 mb-2 flex items-center gap-2">
                    <Megaphone className="w-4 h-4" />
                    营销问题
                  </h4>
                  <ul className="text-sm text-orange-700 space-y-1">
                    {analysisResult.marketingIssues.map((f, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-orange-400 mt-0.5">•</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysisResult.approvalRisks.length > 0 && (
                <div className="bg-red-50 rounded-lg p-4">
                  <h4 className="font-medium text-red-800 mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    审核风险
                  </h4>
                  <ul className="text-sm text-red-700 space-y-1">
                    {analysisResult.approvalRisks.map((f, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-red-400 mt-0.5">•</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="bg-blue-50 rounded-lg p-4">
                <h4 className="font-medium text-blue-800 mb-2 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  综合建议
                </h4>
                <p className="text-sm text-blue-700">{analysisResult.overallSuggestion}</p>
              </div>
            </div>
          </div>
        )}

        {/* Optimize Panel */}
        {analysisResult && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-fade-in-up">
            <button
              onClick={() => setShowOptimizePanel(!showOptimizePanel)}
              className="w-full flex items-center justify-between p-6 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Sparkles className="w-5 h-5 text-[#004B73]" />
                <span className="text-lg font-semibold text-slate-800">优化面板</span>
              </div>
              {showOptimizePanel ? (
                <ChevronUp className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {showOptimizePanel && (
              <div className="px-6 pb-6 border-t border-slate-100">
                {/* Optimize Options */}
                <div className="grid grid-cols-2 gap-3 py-4">
                  <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
                    <input
                      type="checkbox"
                      checked={optimizeOptions.reduceAigc}
                      onChange={(e) =>
                        setOptimizeOptions({ ...optimizeOptions, reduceAigc: e.target.checked })
                      }
                      className="w-4 h-4 rounded border-slate-300 text-[#004B73] focus:ring-[#004B73]"
                    />
                    <div>
                      <div className="font-medium text-slate-700">降低 AIGC 率</div>
                      <div className="text-xs text-slate-500">让文章更自然，像真人写作</div>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
                    <input
                      type="checkbox"
                      checked={optimizeOptions.reduceMarketing}
                      onChange={(e) =>
                        setOptimizeOptions({ ...optimizeOptions, reduceMarketing: e.target.checked })
                      }
                      className="w-4 h-4 rounded border-slate-300 text-[#004B73] focus:ring-[#004B73]"
                    />
                    <div>
                      <div className="font-medium text-slate-700">弱化营销性质</div>
                      <div className="text-xs text-slate-500">减少软文痕迹，更加客观</div>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
                    <input
                      type="checkbox"
                      checked={optimizeOptions.improveApproval}
                      onChange={(e) =>
                        setOptimizeOptions({ ...optimizeOptions, improveApproval: e.target.checked })
                      }
                      className="w-4 h-4 rounded border-slate-300 text-[#004B73] focus:ring-[#004B73]"
                    />
                    <div>
                      <div className="font-medium text-slate-700">提升审核通过率</div>
                      <div className="text-xs text-slate-500">规避平台审核风险</div>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
                    <input
                      type="checkbox"
                      checked={optimizeOptions.preserveCore}
                      onChange={(e) =>
                        setOptimizeOptions({ ...optimizeOptions, preserveCore: e.target.checked })
                      }
                      className="w-4 h-4 rounded border-slate-300 text-[#004B73] focus:ring-[#004B73]"
                    />
                    <div>
                      <div className="font-medium text-slate-700">保持核心观点</div>
                      <div className="text-xs text-slate-500">确保主要信息不丢失</div>
                    </div>
                  </label>
                </div>

                {/* AIGC 降低强度选项 */}
                {optimizeOptions.reduceAigc && (
                  <div className="mb-4 p-4 bg-purple-50 rounded-lg border border-purple-100">
                    <h4 className="font-medium text-purple-800 mb-3 flex items-center gap-2">
                      <Bot className="w-4 h-4" />
                      AIGC 降低策略（重点优化）
                    </h4>

                    <div className="mb-4">
                      <label className="block text-sm font-medium text-purple-700 mb-2">改写强度</label>
                      <div className="flex gap-2">
                        {[
                          { value: "light", label: "轻度", desc: "仅删除明显AI词汇" },
                          { value: "medium", label: "中度", desc: "调整句式+口语化" },
                          { value: "aggressive", label: "激进", desc: "大幅重写+网络用语" },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => setOptimizeOptions({ ...optimizeOptions, aigcIntensity: opt.value as "light" | "medium" | "aggressive" })}
                            className={cn(
                              "flex-1 p-3 rounded-lg border-2 transition-all text-left",
                              optimizeOptions.aigcIntensity === opt.value
                                ? "border-purple-500 bg-purple-100"
                                : "border-transparent bg-white hover:border-purple-200"
                            )}
                          >
                            <div className="font-medium text-purple-800">{opt.label}</div>
                            <div className="text-xs text-purple-600">{opt.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="flex items-center gap-3 p-2 bg-white rounded-lg cursor-pointer hover:bg-purple-50 transition-colors">
                        <input
                          type="checkbox"
                          checked={optimizeOptions.addPersonalStory}
                          onChange={(e) => setOptimizeOptions({ ...optimizeOptions, addPersonalStory: e.target.checked })}
                          className="w-4 h-4 rounded border-purple-300 text-purple-600 focus:ring-purple-500"
                        />
                        <div>
                          <div className="text-sm font-medium text-purple-700">添加个人经历</div>
                          <div className="text-xs text-purple-500">虚构真实感的场景和故事</div>
                        </div>
                      </label>
                      <label className="flex items-center gap-3 p-2 bg-white rounded-lg cursor-pointer hover:bg-purple-50 transition-colors">
                        <input
                          type="checkbox"
                          checked={optimizeOptions.useSlang}
                          onChange={(e) => setOptimizeOptions({ ...optimizeOptions, useSlang: e.target.checked })}
                          className="w-4 h-4 rounded border-purple-300 text-purple-600 focus:ring-purple-500"
                        />
                        <div>
                          <div className="text-sm font-medium text-purple-700">使用口语/俚语</div>
                          <div className="text-xs text-purple-500">用"搞、整、弄"替代书面语</div>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {/* 营销降低策略选项 */}
                {optimizeOptions.reduceMarketing && (
                  <div className="mb-4 p-4 bg-orange-50 rounded-lg border border-orange-100">
                    <h4 className="font-medium text-orange-800 mb-3 flex items-center gap-2">
                      <Megaphone className="w-4 h-4" />
                      营销降低策略（去软文化）
                    </h4>

                    <div className="mb-4">
                      <label className="block text-sm font-medium text-orange-700 mb-2">弱化强度</label>
                      <div className="flex gap-2">
                        {[
                          { value: "light", label: "轻度", desc: "删除明显广告词" },
                          { value: "medium", label: "中度", desc: "转为经验分享风格" },
                          { value: "aggressive", label: "激进", desc: "完全去除推销感" },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => setOptimizeOptions({ ...optimizeOptions, marketingIntensity: opt.value as "light" | "medium" | "aggressive" })}
                            className={cn(
                              "flex-1 p-3 rounded-lg border-2 transition-all text-left",
                              optimizeOptions.marketingIntensity === opt.value
                                ? "border-orange-500 bg-orange-100"
                                : "border-transparent bg-white hover:border-orange-200"
                            )}
                          >
                            <div className="font-medium text-orange-800">{opt.label}</div>
                            <div className="text-xs text-orange-600">{opt.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="flex items-center gap-3 p-2 bg-white rounded-lg cursor-pointer hover:bg-orange-50 transition-colors">
                        <input
                          type="checkbox"
                          checked={optimizeOptions.removeBrandMention}
                          onChange={(e) => setOptimizeOptions({ ...optimizeOptions, removeBrandMention: e.target.checked })}
                          className="w-4 h-4 rounded border-orange-300 text-orange-600 focus:ring-orange-500"
                        />
                        <div>
                          <div className="text-sm font-medium text-orange-700">减少品牌露出</div>
                          <div className="text-xs text-orange-500">品牌名最多出现1次，用"这款"替代</div>
                        </div>
                      </label>
                      <label className="flex items-center gap-3 p-2 bg-white rounded-lg cursor-pointer hover:bg-orange-50 transition-colors">
                        <input
                          type="checkbox"
                          checked={optimizeOptions.removeCTA}
                          onChange={(e) => setOptimizeOptions({ ...optimizeOptions, removeCTA: e.target.checked })}
                          className="w-4 h-4 rounded border-orange-300 text-orange-600 focus:ring-orange-500"
                        />
                        <div>
                          <div className="text-sm font-medium text-orange-700">删除行动引导(CTA)</div>
                          <div className="text-xs text-orange-500">删除"快去买"、联系方式、促销信息</div>
                        </div>
                      </label>
                      <label className="flex items-center gap-3 p-2 bg-white rounded-lg cursor-pointer hover:bg-orange-50 transition-colors">
                        <input
                          type="checkbox"
                          checked={optimizeOptions.addObjectiveView}
                          onChange={(e) => setOptimizeOptions({ ...optimizeOptions, addObjectiveView: e.target.checked })}
                          className="w-4 h-4 rounded border-orange-300 text-orange-600 focus:ring-orange-500"
                        />
                        <div>
                          <div className="text-sm font-medium text-orange-700">添加客观评价</div>
                          <div className="text-xs text-orange-500">提及缺点、不适合人群、不同观点</div>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {/* Optimize Button */}
                <div className="flex justify-end mb-4">
                  <button
                    onClick={handleOptimize}
                    disabled={status === "optimizing" || (!optimizeOptions.reduceAigc && !optimizeOptions.reduceMarketing && !optimizeOptions.improveApproval)}
                    className={cn(
                      "flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all",
                      status === "optimizing"
                        ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                        : "bg-gradient-to-r from-[#004B73] to-[#0077B6] text-white hover:shadow-lg hover:shadow-blue-300/40"
                    )}
                  >
                    {status === "optimizing" ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        优化中...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        一键优化
                      </>
                    )}
                  </button>
                </div>

                {/* Optimized Result */}
                {optimizeResult && (
                  <div className="space-y-4 animate-fade-in-up">
                    <div className="bg-green-50 rounded-lg p-4">
                      <h4 className="font-medium text-green-800 mb-2 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4" />
                        主要修改
                      </h4>
                      <ul className="text-sm text-green-700 space-y-1">
                        {optimizeResult.changes.map((c, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-green-400 mt-0.5">•</span>
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-slate-50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-slate-800">优化后的文章</h4>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleCopy(optimizeResult.optimizedContent)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            {copied ? "已复制" : "复制"}
                          </button>
                          <button
                            onClick={handleUseOptimized}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#004B73] hover:bg-[#004B73]/10 rounded-lg transition-colors"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            使用此版本
                          </button>
                        </div>
                      </div>
                      <div className="bg-white rounded-lg p-4 border border-slate-200 text-slate-700 whitespace-pre-wrap max-h-96 overflow-y-auto">
                        {optimizeResult.optimizedContent}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
