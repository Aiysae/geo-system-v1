"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Lightbulb, Loader2, Sparkles, Globe, ExternalLink, Settings2 } from "lucide-react"
import StrategyTable from "./strategy-table"
import { apiFetch } from "@/lib/api-fetch"
import type { Client, DiagnosisDimensions, StrategyResult } from "@/types"

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
}

const DIM_LABELS: Record<keyof DiagnosisDimensions, string> = {
  authority: "信源权威性",
  structure: "内容结构化",
  traceability: "信息可追溯",
  coverage: "关键词覆盖",
  sentiment: "情感倾向",
}

export default function StrategyModule({ client, onChangeClient }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keywordCount, setKeywordCount] = useState<string>("")
  const [questionCount, setQuestionCount] = useState<string>("")
  const [mustInclude, setMustInclude] = useState<string>("")

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const missedQuestions = client.penetration?.aggregated.missedQuestions ?? []
      const topCompetitors = client.penetration?.aggregated.topCompetitors ?? client.competitors

      let weakDimensions: string[] = []
      if (client.diagnosis) {
        weakDimensions = (Object.keys(client.diagnosis.dimensions) as Array<keyof DiagnosisDimensions>)
          .filter(k => client.diagnosis!.dimensions[k] < 60)
          .map(k => `${DIM_LABELS[k]}(${client.diagnosis!.dimensions[k]}分)`)
      }

      const parsedKw = parseCount(keywordCount)
      const parsedQ = parseCount(questionCount)
      const mustIncludeKeywords = mustInclude
        .split(/[,，、\s\n]+/)
        .map(s => s.trim())
        .filter(Boolean)

      const res = await apiFetch("/api/strategy", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ourBrand: client.ourBrand,
          industry: client.industry,
          missedQuestions,
          topCompetitors,
          weakDimensions,
          keywordCount: parsedKw,
          questionCount: parsedQ,
          mustIncludeKeywords,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "策略生成失败")
      const result: StrategyResult = {
        rows: data.rows,
        websiteMatrix: data.websiteMatrix,
        generatedAt: data.generatedAt,
      }
      onChangeClient({ strategy: result })
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setLoading(false)
    }
  }

  const strategy = client.strategy
  const ready = !!client.ourBrand.trim()
  const hasContext = !!client.penetration || !!client.diagnosis

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 via-orange-500 to-pink-500 flex items-center justify-center shadow-lg shadow-orange-200/50">
              <Lightbulb className="h-5 w-5 text-white" />
            </span>
            <span className="bg-gradient-to-r from-orange-600 to-pink-600 bg-clip-text text-transparent font-semibold">
              模块三 · 一键 GEO 渗透策略
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasContext && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-4">
            建议先完成 <b>模块一渗透率检测</b> 与 <b>模块二诊断</b>，AI 会基于这些数据生成更精准的策略。当前可在缺数据下生成兜底策略。
          </div>
        )}

        {/* 自定义参数配置区 */}
        <div className="rounded-xl border border-slate-200/70 bg-gradient-to-br from-white via-slate-50/40 to-blue-50/40 p-4 mb-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#0077B6] to-[#00B4D8] flex items-center justify-center shadow shadow-cyan-200/60">
              <Settings2 className="h-3.5 w-3.5 text-white" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-800">自定义策略生成参数</div>
              <div className="text-[11px] text-slate-500">所有字段均可留空，AI 会自行根据大盘数据推演合适数量与内容</div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label className="text-xs text-slate-600 mb-1.5 block">生成关键词数量</Label>
              <Input
                type="number"
                min={0}
                max={50}
                value={keywordCount}
                onChange={e => setKeywordCount(e.target.value)}
                placeholder="留空 = AI 自动推演"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-600 mb-1.5 block">生成疑问句数量</Label>
              <Input
                type="number"
                min={0}
                max={50}
                value={questionCount}
                onChange={e => setQuestionCount(e.target.value)}
                placeholder="留空 = AI 自动推演"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-600 mb-1.5 block">必须包含的核心词</Label>
              <Input
                value={mustInclude}
                onChange={e => setMustInclude(e.target.value)}
                placeholder="多个用逗号分隔，如：势途, 企业 AI"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              onClick={run}
              disabled={loading || !ready}
              className="gap-1.5 bg-gradient-to-r from-[#004B73] to-[#0077B6] hover:shadow-lg hover:shadow-blue-300/40 hover:-translate-y-0.5 transition-all border-0"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {loading ? "推演中..." : strategy ? "重新生成 GEO 渗透策略" : "一键生成 GEO 渗透策略"}
            </Button>
          </div>
        </div>

        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5 mb-4">
            {error}
          </div>
        )}

        {!strategy ? (
          <div className="flex min-h-[200px] items-center justify-center text-center">
            <div>
              <div className="text-sm text-slate-500 mb-1">策略表待生成</div>
              <div className="text-xs text-slate-400">
                自动结合「未提及疑问句 + 主要竞品 + 失分项」推演长期实操策略
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <StrategyTable rows={strategy.rows} />

            <WebsiteMatrixPanel matrix={strategy.websiteMatrix ?? []} />

            <div className="text-[11px] text-slate-400 text-right">
              生成于 {new Date(strategy.generatedAt).toLocaleString("zh-CN")}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function parseCount(v: string): number | null {
  const s = v.trim()
  if (!s) return null
  const n = Math.floor(Number(s))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(n, 50)
}

function WebsiteMatrixPanel({ matrix }: { matrix: NonNullable<StrategyResult["websiteMatrix"]> }) {
  return (
    <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 via-white to-purple-50/40 p-5">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-md shadow-indigo-200/60">
          <Globe className="h-4 w-4 text-white" />
        </span>
        <div>
          <div className="text-sm font-semibold text-slate-800">网站矩阵搭建建议</div>
          <div className="text-[11px] text-slate-500">
            为信息源做交叉验证 · 每个站点都伪装成独立第三方，覆盖不同 AI 抓取视角
          </div>
        </div>
      </div>

      {matrix.length === 0 ? (
        <div className="mt-4 text-xs text-slate-500 bg-white/60 border border-dashed border-slate-200 rounded-lg p-3">
          本次未生成网站矩阵建议（可能是 AI 返回缺失），请点击「重新生成」再试。
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {matrix.map((item, i) => (
            <div
              key={i}
              className="group rounded-xl border border-slate-200/70 bg-white/80 backdrop-blur p-4 hover:shadow-lg hover:shadow-indigo-100 hover:-translate-y-0.5 transition-all"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-sm font-semibold text-slate-800">{item.siteType}</div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                  #{i + 1}
                </span>
              </div>
              <div className="text-xs text-slate-600 leading-relaxed mb-2">
                <span className="text-indigo-600 font-medium">战略意图：</span>
                {item.strategicIntent}
              </div>
              {item.contentFocus && (
                <div className="text-xs text-slate-500 leading-relaxed mb-2.5">
                  <span className="text-slate-700 font-medium">首批内容：</span>
                  {item.contentFocus}
                </div>
              )}
              {item.domainSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {item.domainSuggestions.map((d, j) => (
                    <code
                      key={j}
                      className="text-[11px] px-2 py-1 rounded-md bg-slate-900 text-emerald-300 font-mono"
                    >
                      {d}
                    </code>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3 rounded-xl bg-white/70 border border-slate-200 px-4 py-3">
        <div className="text-xs text-slate-600">
          想要的域名是否可注册？前往腾讯云 DNSPod 一键查询：
        </div>
        <a
          href="https://dnspod.cloud.tencent.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-lg bg-gradient-to-r from-[#004B73] to-[#0077B6] text-white hover:shadow-lg hover:shadow-blue-200 hover:-translate-y-0.5 transition-all whitespace-nowrap"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          前往腾讯云查询域名
        </a>
      </div>
    </div>
  )
}
