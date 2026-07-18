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
import { CreditCostBadge } from "@/components/credits/credit-cost-badge"
import { useResumableBackgroundJob } from "@/hooks/use-resumable-background-job"
import { createBackgroundRequestId } from "@/lib/background-job-client"
import { getClientSubjectType } from "@/lib/analysis-subject"
import type { BackgroundJobRef, Client, Diagnosis } from "@/types"

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
}

export default function DiagnosisModule({ client, onChangeClient }: Props) {
  const subjectType = getClientSubjectType(client)
  const isPerson = subjectType === "person"
  const [error, setError] = useState<string | null>(null)
  const jobRef = client.backgroundJobs?.diagnosis
  const loading = Boolean(jobRef)
  const payload = {
    ourBrand: client.ourBrand,
    industry: client.industry,
    website: client.website,
    penetration: client.penetration,
    subjectType,
    personProfile: client.personProfile,
  }

  function backgroundJobsWith(ref?: BackgroundJobRef) {
    const next = { ...(client.backgroundJobs || {}) }
    if (ref) next.diagnosis = ref
    else delete next.diagnosis
    return next
  }

  const jobState = useResumableBackgroundJob<Diagnosis>({
    kind: "diagnosis",
    clientId: client.id,
    jobRef,
    payload,
    onAccepted: job => {
      onChangeClient({
        backgroundJobs: backgroundJobsWith({ requestId: job.requestId, jobId: job.id }),
      })
    },
    onSucceeded: job => {
      if (!job.result?.generatedAt) {
        setError("后台诊断任务返回数据不完整，请重新生成。")
        onChangeClient({ backgroundJobs: backgroundJobsWith() })
        return
      }
      setError(null)
      onChangeClient({
        diagnosis: job.result,
        backgroundJobs: backgroundJobsWith(),
      })
    },
    onFailed: message => {
      setError(message)
      onChangeClient({ backgroundJobs: backgroundJobsWith() })
    },
  })

  function run() {
    setError(null)
    onChangeClient({
      backgroundJobs: backgroundJobsWith({
        requestId: createBackgroundRequestId("diagnosis"),
        payload,
      }),
    })
  }

  const diag = client.diagnosis

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:text-base">
          <div className="flex items-center gap-3">
            <span className="geo-module-icon">
              <Radar className="h-5 w-5 text-white" />
            </span>
            <span className="geo-module-title min-w-0 text-base sm:text-lg">
              {isPerson ? "个人 IP 多维 AI 诊断面板" : "多维 AI 诊断面板"}
            </span>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <CreditCostBadge featureKey="diagnose" />
            <Button
              size="sm"
              onClick={run}
              disabled={loading || !client.ourBrand.trim()}
              variant={diag ? "outline" : "default"}
              className={diag ? "w-full gap-1.5 sm:w-auto" : "w-full gap-1.5 border-[#2F54EB] bg-[#2F54EB] hover:border-[#1D39C4] hover:bg-[#1D39C4] sm:w-auto"}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : diag ? (
                <RefreshCw className="h-3.5 w-3.5" />
              ) : null}
              {loading ? "诊断中..." : diag ? "重新诊断" : "开始诊断"}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-5">
          <Label className="text-xs text-slate-600 mb-1.5 block">
            {isPerson ? "个人主页/机构资料页 URL（可选）" : "官网/品牌主阵地 URL（可选）"}
          </Label>
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

        {loading && (
          <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-800">
            <div className="font-medium">{jobState.currentJob?.stage || "诊断任务正在转入服务器后台"}</div>
            <div className="text-[11px] text-violet-700/80">
              {jobState.connectionNotice || "可以切换客户或刷新页面，诊断结果会自动恢复。"}
            </div>
          </div>
        )}

        {!diag ? (
          <div className="geo-empty-state min-h-[160px]">
            <div>
              <div className="text-sm text-slate-500 mb-1">诊断报告待生成</div>
              <div className="text-xs text-slate-400">
                {client.penetration
                  ? "已检测到渗透率数据，将一并纳入分析"
                  : "建议先完成渗透率检测以提高诊断准确度"}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-5 md:grid-cols-[260px_1fr]">
              <GemScorePanel score={diag.gemScore} />
              <div className="geo-panel bg-white p-3">
                <div className="mb-2 px-2 text-[11px] font-semibold text-[#60758D]">
                  五维诊断雷达图
                </div>
                <RadarFiveDim dimensions={diag.dimensions} subjectType={subjectType} />
              </div>
            </div>

            <div className="geo-panel bg-white p-4">
              <div className="mb-3 text-[11px] font-semibold text-[#60758D]">
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
