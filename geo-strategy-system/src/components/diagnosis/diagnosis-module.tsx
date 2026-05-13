"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Radar, Loader2, RefreshCw } from "lucide-react"
import GemScorePanel from "./gem-score-panel"
import RadarFiveDim from "./radar-five-dim"
import ModelTabs from "./model-tabs"
import { apiFetch } from "@/lib/api-fetch"
import type { Client, Diagnosis } from "@/types"

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
}

export default function DiagnosisModule({ client, onChangeClient }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch("/api/diagnose", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ourBrand: client.ourBrand,
          industry: client.industry,
          website: client.website,
          penetration: client.penetration,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "诊断失败")
      const d: Diagnosis = {
        gemScore: data.gemScore,
        dimensions: data.dimensions,
        modelDiagnosis: data.modelDiagnosis,
        generatedAt: data.generatedAt,
      }
      onChangeClient({ diagnosis: d })
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setLoading(false)
    }
  }

  const diag = client.diagnosis

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-purple-200/50">
              <Radar className="h-5 w-5 text-white" />
            </span>
            <span className="bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent font-semibold">
              模块二 · 多维 AI 诊断面板
            </span>
          </div>
          <Button
            size="sm"
            onClick={run}
            disabled={loading || !client.ourBrand.trim()}
            variant={diag ? "outline" : "default"}
            className={diag ? "gap-1.5" : "gap-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:shadow-lg hover:shadow-purple-300/40 hover:-translate-y-0.5 transition-all border-0"}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : diag ? (
              <RefreshCw className="h-3.5 w-3.5" />
            ) : null}
            {loading ? "诊断中..." : diag ? "重新诊断" : "开始诊断"}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-5">
          <Label className="text-xs text-slate-600 mb-1.5 block">官网/品牌主阵地 URL（可选）</Label>
          <Input
            value={client.website}
            onChange={e => onChangeClient({ website: e.target.value })}
            placeholder="https://..."
            className="max-w-md"
          />
        </div>

        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5 mb-4">
            {error}
          </div>
        )}

        {!diag ? (
          <div className="flex min-h-[200px] items-center justify-center text-center">
            <div>
              <div className="text-sm text-slate-500 mb-1">诊断报告待生成</div>
              <div className="text-xs text-slate-400">
                {client.penetration
                  ? "已检测到渗透率数据，将一并纳入分析"
                  : "建议先完成模块一渗透率检测以提高诊断准确度"}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-5 md:grid-cols-[260px_1fr]">
              <GemScorePanel score={diag.gemScore} />
              <div className="rounded-xl border border-slate-200 p-3 bg-white">
                <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-2 px-2">
                  五维诊断雷达图
                </div>
                <RadarFiveDim dimensions={diag.dimensions} />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4 bg-white">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-3">
                国内派系差异化诊断
              </div>
              <ModelTabs data={diag.modelDiagnosis} />
            </div>

            <div className="text-[11px] text-slate-400 text-right">
              生成于 {new Date(diag.generatedAt).toLocaleString("zh-CN")}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
