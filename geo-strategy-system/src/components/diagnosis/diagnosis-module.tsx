"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Globe2, Loader2, Radar, RefreshCw } from "lucide-react"
import GemScorePanel from "./gem-score-panel"
import RadarFiveDim from "./radar-five-dim"
import ModelTabs from "./model-tabs"
import { CreditCostBadge } from "@/components/credits/credit-cost-badge"
import { useResumableBackgroundJob } from "@/hooks/use-resumable-background-job"
import { createBackgroundRequestId } from "@/lib/background-job-client"
import { getClientSubjectType } from "@/lib/analysis-subject"
import { toUserFacingError } from "@/lib/user-facing-errors"
import type { BackgroundJobRef, Client, Diagnosis } from "@/types"

const GeoAuditReport = dynamic(
  () => import("@/components/diagnosis/geo-audit-report"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-72 items-center justify-center text-xs text-slate-400">
        诊断报告加载中...
      </div>
    ),
  },
)

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
        setError("诊断结果不完整，请重新生成。")
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
      setError(toUserFacingError(message, { fallback: "诊断未完成，请稍后重试。", subject: "诊断" }))
      onChangeClient({ backgroundJobs: backgroundJobsWith() })
    },
  })

  function run() {
    if (!client.website.trim()) {
      setError(isPerson ? "请先填写个人主页或机构资料页网址。" : "请先填写需要诊断的官网网址。")
      return
    }
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
    <div className="geo-module-surface">
      <div className="geo-module-header">
        <div className="flex w-full flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:text-base">
          <div className="flex items-center gap-3">
            <span className="geo-module-icon">
              <Radar className="h-5 w-5 text-white" />
            </span>
            <div className="min-w-0">
              <div className="geo-module-title">
                {isPerson ? "个人 IP 页面 GEO 诊断" : "网站 GEO 诊断"}
              </div>
              <div className="geo-module-description">
                基于公开页面、爬虫规则和内容证据生成诊断报告
              </div>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <CreditCostBadge featureKey="diagnose" />
            <Button
              size="sm"
              onClick={run}
              disabled={loading || !client.ourBrand.trim() || !client.website.trim()}
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
        </div>
      </div>
      <div className="p-3 sm:p-4">
        <div className="mb-4 rounded-lg border border-[#D8E9FA] bg-[#F7FBFF] p-3 sm:p-4">
          <Label className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-slate-700">
            <Globe2 className="h-3.5 w-3.5 text-[#1677FF]" />
            {isPerson ? "个人主页或机构资料页网址" : "需要诊断的官网网址"}
            <span className="text-rose-500">*</span>
          </Label>
          <Input
            value={client.website}
            onChange={e => onChangeClient({ website: e.target.value })}
            placeholder="https://www.example.com"
            inputMode="url"
            autoComplete="url"
          />
        </div>

        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5 mb-4">
            {error}
          </div>
        )}

        {loading && (
          <div className="mb-4 rounded-lg border border-[#B7DAFF] bg-[#EDF6FF] px-3 py-2.5 text-xs leading-5 text-[#0958D9]">
            <div className="font-semibold">{jobState.currentJob?.stage || "正在读取网站"}</div>
            <div className="text-[11px] text-[#0958D9]/75">
              {jobState.connectionNotice || "可以继续使用其他功能，完成后结果会自动保存。"}
            </div>
          </div>
        )}

        {!diag ? (
          <div className="geo-empty-state min-h-[160px]">
            <div>
              <div className="mb-1 text-sm text-slate-500">诊断报告待生成</div>
              <div className="text-xs text-slate-400">
                填写网站后开始诊断
              </div>
            </div>
          </div>
        ) : diag.audit?.version === 2 ? (
          <GeoAuditReport audit={diag.audit} />
        ) : (
          <div className="space-y-6">
            <div className="grid gap-5 md:grid-cols-[260px_1fr]">
              <GemScorePanel score={diag.gemScore} />
              <div className="geo-panel bg-white p-3">
                <div className="mb-2 px-2 text-[11px] font-semibold text-[#60758D]">
                  五维表现
                </div>
                <RadarFiveDim dimensions={diag.dimensions} subjectType={subjectType} />
              </div>
            </div>

            <div className="geo-panel bg-white p-4">
              <div className="mb-3 text-[11px] font-semibold text-[#60758D]">
                各模型表现
              </div>
              <ModelTabs data={diag.modelDiagnosis} />
            </div>

            <div className="text-[11px] text-slate-400 text-right">
              生成于 {new Date(diag.generatedAt).toLocaleString("zh-CN")}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
