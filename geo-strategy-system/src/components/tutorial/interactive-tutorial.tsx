"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BookOpenCheck,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Clock3,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Gauge,
  GraduationCap,
  Landmark,
  Layers3,
  ListChecks,
  LoaderCircle,
  Network,
  Play,
  Radar,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound,
  WandSparkles,
} from "lucide-react"
import BrandRankingCard from "@/components/penetration/brand-ranking-card"
import ModelRateTrend from "@/components/penetration/model-rate-trend"
import PenetrationDonut from "@/components/penetration/penetration-donut"
import DifficultyDimensionsRadial from "@/components/difficulty/difficulty-dimensions-radial"
import DiamondStarfield from "@/components/brand/diamond-starfield"
import {
  TUTORIAL_DEMOS,
  type TutorialDemo,
  type TutorialIntentId,
} from "@/lib/tutorial-data"
import type { AnalysisSubjectType, WorkspaceAccountAccess } from "@/types"
import type { OnboardingAction, OnboardingSummary } from "@/types/onboarding"

type Props = {
  userName: string
  access: WorkspaceAccountAccess
  onboarding: OnboardingSummary
  manual: boolean
}

type InsightTab = "research" | "diagnosis" | "difficulty"

const STEPS = [
  { id: 0, label: "开始体验", short: "开始", icon: GraduationCap },
  { id: 1, label: "建立分析档案", short: "档案", icon: Building2 },
  { id: 2, label: "疑问句检测", short: "检测", icon: SearchCheck },
  { id: 3, label: "查看渗透结果", short: "结果", icon: BarChart3 },
  { id: 4, label: "诊断难度与成本", short: "诊断", icon: Gauge },
  { id: 5, label: "形成关键词策略", short: "策略", icon: ListChecks },
  { id: 6, label: "生成内容资产", short: "内容", icon: FileText },
  { id: 7, label: "报告与持续反馈", short: "交付", icon: BadgeCheck },
] as const

const STANDARD_FLOW = STEPS.map(step => step.id)
const CLIENT_FLOW = [0, 2, 3, 7] as const

function initialCanonicalStep(
  flow: readonly number[],
  onboarding: OnboardingSummary,
  manual: boolean,
): number {
  if (manual) return flow[0]
  if (flow.includes(onboarding.state.currentStep)) {
    return onboarding.state.currentStep
  }
  return flow.find(step => step >= onboarding.state.currentStep) ?? flow[0]
}

export default function InteractiveTutorial({
  userName,
  access,
  onboarding,
  manual,
}: Props) {
  const restricted = access.mode === "client"
  const flow = useMemo<readonly number[]>(
    () => restricted ? CLIENT_FLOW : STANDARD_FLOW,
    [restricted],
  )
  const [subjectType, setSubjectType] = useState<AnalysisSubjectType>(
    onboarding.state.subjectType,
  )
  const [currentStep, setCurrentStep] = useState(() => (
    initialCanonicalStep(flow, onboarding, manual)
  ))
  const [maxVisitedIndex, setMaxVisitedIndex] = useState(() => (
    Math.max(0, flow.indexOf(initialCanonicalStep(flow, onboarding, manual)))
  ))
  const [selectedIntent, setSelectedIntent] = useState<TutorialIntentId>("recommendation")
  const [answerRevealed, setAnswerRevealed] = useState(false)
  const [articleGenerated, setArticleGenerated] = useState(false)
  const [strategyExpanded, setStrategyExpanded] = useState(false)
  const [insightTab, setInsightTab] = useState<InsightTab>("difficulty")
  const [saving, setSaving] = useState(false)
  const startRecordedRef = useRef(false)

  const demo = TUTORIAL_DEMOS[subjectType]
  const flowIndex = Math.max(0, flow.indexOf(currentStep))
  const progress = Math.round(((flowIndex + 1) / flow.length) * 100)
  const currentDefinition = STEPS.find(step => step.id === currentStep) ?? STEPS[0]
  const isLastStep = flowIndex === flow.length - 1

  const updateState = useCallback(async (
    action: OnboardingAction,
    step = currentStep,
    nextSubject = subjectType,
  ) => {
    try {
      await fetch("/api/onboarding", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          currentStep: step,
          subjectType: nextSubject,
        }),
      })
    } catch {
      // Progress persistence is helpful but must never interrupt the tutorial.
    }
  }, [currentStep, subjectType])

  useEffect(() => {
    if (
      !manual
      && onboarding.state.status === "not_started"
      && !startRecordedRef.current
    ) {
      startRecordedRef.current = true
      void updateState("start", currentStep, subjectType)
    }
  }, [currentStep, manual, onboarding.state.status, subjectType, updateState])

  function chooseSubject(next: AnalysisSubjectType) {
    setSubjectType(next)
    setAnswerRevealed(false)
    setArticleGenerated(false)
    if (!manual) void updateState("progress", currentStep, next)
  }

  function visitStep(nextStep: number) {
    const nextIndex = flow.indexOf(nextStep)
    if (nextIndex < 0 || nextIndex > maxVisitedIndex) return
    setCurrentStep(nextStep)
    window.scrollTo({ top: 0, behavior: "smooth" })
    if (!manual) void updateState("progress", nextStep)
  }

  function goForward() {
    if (isLastStep) {
      void finishTutorial()
      return
    }
    const nextStep = flow[flowIndex + 1]
    const nextIndex = flowIndex + 1
    setMaxVisitedIndex(value => Math.max(value, nextIndex))
    setCurrentStep(nextStep)
    window.scrollTo({ top: 0, behavior: "smooth" })
    if (!manual) void updateState("progress", nextStep)
  }

  function goBack() {
    if (flowIndex === 0) return
    const previous = flow[flowIndex - 1]
    setCurrentStep(previous)
    window.scrollTo({ top: 0, behavior: "smooth" })
    if (!manual) void updateState("progress", previous)
  }

  async function finishTutorial() {
    if (saving) return
    setSaving(true)
    await updateState("complete", 7)
    window.location.assign("/workspace")
  }

  async function leaveTutorial() {
    if (saving) return
    setSaving(true)
    if (!manual) await updateState("dismiss", currentStep)
    window.location.assign("/workspace")
  }

  const forwardDisabled = currentStep === 2 && !answerRevealed
    || currentStep === 6 && !articleGenerated

  return (
    <div className="min-h-screen bg-[#F3F8FF] text-slate-900">
      <header className="sticky top-0 z-40 border-b border-white/15 bg-[#001D66]/96 text-white shadow-[0_14px_34px_-28px_rgba(0,29,102,0.95)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-3 px-3 sm:px-5">
          <Link
            href="/"
            className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            aria-label="返回势途 GEO 首页"
          >
            <Image
              src="/brand/shitu-lockup.jpg"
              alt="势途"
              width={840}
              height={960}
              sizes="32px"
              priority
              className="h-8 w-auto rounded-md bg-white ring-1 ring-white/20"
            />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">势途 GEO · 新手体验教程</div>
            <div className="hidden text-[10px] text-cyan-50/65 sm:block">
              用一套示例，看懂从检测到交付的完整成果
            </div>
          </div>
          <span className="hidden items-center gap-1.5 rounded-md bg-cyan-300/12 px-2.5 py-1 text-[10px] font-semibold text-cyan-50 ring-1 ring-cyan-200/25 md:inline-flex">
            <Clock3 className="h-3.5 w-3.5" />
            约 3 分钟
          </span>
          <button
            type="button"
            onClick={() => void leaveTutorial()}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-white/8 px-3 text-xs font-semibold transition hover:bg-white/14 disabled:opacity-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{manual ? "返回工作台" : "跳过教程"}</span>
            <span className="sm:hidden">退出</span>
          </button>
        </div>
        <div className="h-0.5 bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-[#00C8FF] via-[#40A9FF] to-[#69DFFF] transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] items-start lg:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="sticky top-[58px] z-30 min-w-0 overflow-hidden border-b border-[#D9E6F3] bg-white/96 px-3 py-2 backdrop-blur lg:h-[calc(100vh-58px)] lg:border-b-0 lg:border-r lg:px-3 lg:py-5">
          <div className="mb-3 hidden px-2 lg:block">
            <p className="text-[10px] font-semibold text-slate-400">体验进度</p>
            <p className="mt-1 truncate text-xs font-semibold text-slate-700">
              {userName || "当前账号"}
            </p>
          </div>
          <nav className="flex gap-1.5 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
            {flow.map((stepId, index) => {
              const item = STEPS.find(step => step.id === stepId) ?? STEPS[0]
              const Icon = item.icon
              const active = stepId === currentStep
              const visited = index <= maxVisitedIndex
              return (
                <button
                  key={stepId}
                  type="button"
                  onClick={() => visitStep(stepId)}
                  disabled={!visited}
                  className={`flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-left text-xs font-semibold transition lg:w-full ${
                    active
                      ? "bg-gradient-to-r from-[#1677FF] to-[#00AEEA] text-white shadow-sm"
                      : visited
                        ? "bg-[#EEF6FF] text-[#0958D9] hover:bg-[#DCEEFF]"
                        : "cursor-not-allowed text-slate-300"
                  }`}
                  aria-current={active ? "step" : undefined}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded ${
                    active ? "bg-white/18" : visited ? "bg-white" : "bg-slate-100"
                  }`}>
                    {index < maxVisitedIndex
                      ? <Check className="h-3.5 w-3.5" />
                      : <Icon className="h-3.5 w-3.5" />}
                  </span>
                  <span className="lg:hidden">{item.short}</span>
                  <span className="hidden lg:inline">{item.label}</span>
                </button>
              )
            })}
          </nav>
          <div className="mt-5 hidden rounded-lg border border-[#B7D9FF] bg-[#EAF5FF] px-3 py-3 lg:block">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#0958D9]">
              <ShieldCheck className="h-4 w-4" />
              放心体验
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-[#456783]">
              示例结果即时呈现，不消耗积分，也不会改动客户资料。
            </p>
          </div>
        </aside>

        <main className="min-w-0 px-3 pb-24 pt-4 sm:px-5 lg:px-7 lg:pt-6">
          <div className="mx-auto max-w-[1180px]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold text-[#1677FF]">
                  第 {flowIndex + 1} 步 / 共 {flow.length} 步
                  <span className="h-1 w-1 rounded-full bg-[#00C8FF]" />
                  {subjectType === "person" ? "个人 IP 示例" : "品牌示例"}
                </div>
                <h1 className="geo-display-title mt-1 text-xl text-slate-950 sm:text-2xl">
                  {currentDefinition.label}
                </h1>
              </div>
              <span className="hidden rounded-md bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200 sm:inline-flex">
                演示数据
              </span>
            </div>

            {currentStep === 0 ? (
              <WelcomeStep
                demo={demo}
                subjectType={subjectType}
                onChooseSubject={chooseSubject}
                restricted={restricted}
              />
            ) : null}
            {currentStep === 1 ? <ProfileStep demo={demo} /> : null}
            {currentStep === 2 ? (
              <DetectionStep
                demo={demo}
                selectedIntent={selectedIntent}
                answerRevealed={answerRevealed}
                onSelectIntent={intent => {
                  setSelectedIntent(intent)
                  setAnswerRevealed(false)
                }}
                onRun={() => setAnswerRevealed(true)}
              />
            ) : null}
            {currentStep === 3 ? <ResultsStep demo={demo} /> : null}
            {currentStep === 4 ? (
              <InsightStep
                demo={demo}
                activeTab={insightTab}
                onChangeTab={setInsightTab}
              />
            ) : null}
            {currentStep === 5 ? (
              <StrategyStep
                demo={demo}
                expanded={strategyExpanded}
                onToggle={() => setStrategyExpanded(value => !value)}
              />
            ) : null}
            {currentStep === 6 ? (
              <ArticleStep
                demo={demo}
                generated={articleGenerated}
                onGenerate={() => setArticleGenerated(true)}
              />
            ) : null}
            {currentStep === 7 ? (
              <DeliveryStep demo={demo} restricted={restricted} />
            ) : null}
          </div>
        </main>
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-[#D8E5F2] bg-white/96 px-3 py-2.5 shadow-[0_-14px_34px_-28px_rgba(15,56,98,0.65)] backdrop-blur lg:left-[224px]">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
            disabled={flowIndex === 0 || saving}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#C8D7E8] bg-white px-4 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" />
            上一步
          </button>
          <div className="hidden text-center text-[11px] text-slate-400 sm:block">
            {forwardDisabled ? "先完成本页的示例操作，再继续下一步" : "内容已准备好，可以继续"}
          </div>
          <button
            type="button"
            onClick={goForward}
            disabled={forwardDisabled || saving}
            className="inline-flex h-10 min-w-28 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white shadow-[0_12px_26px_-16px_rgba(0,119,255,0.9)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {saving ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : isLastStep ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            {isLastStep ? "进入工作台" : "下一步"}
          </button>
        </div>
      </footer>
    </div>
  )
}

function WelcomeStep({
  demo,
  subjectType,
  onChooseSubject,
  restricted,
}: {
  demo: TutorialDemo
  subjectType: AnalysisSubjectType
  onChooseSubject: (value: AnalysisSubjectType) => void
  restricted: boolean
}) {
  const deliverables = restricted
    ? [
        "查看关联主体的真实联网检测结果",
        "对比每次检测的渗透率与竞争变化",
        "查看周报、月报和执行动作记录",
        "打开在线报告核验信源与历史数据",
      ]
    : [
        "看清品牌或个人 IP 在不同模型中的真实可见度",
        "识别主要竞品、信源平台和内容机会",
        "得到难度、周期、成本与执行优先级",
        "生成疑问句、文章、报告和客户反馈",
      ]

  return (
    <section className="relative min-h-[560px] overflow-hidden rounded-lg bg-[#001D66] text-white shadow-[0_28px_60px_-36px_rgba(0,55,150,0.9)]">
      <DiamondStarfield />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_20%,rgba(0,200,255,0.2),transparent_34%),linear-gradient(120deg,rgba(0,29,102,0.98),rgba(0,62,179,0.82),rgba(0,174,234,0.72))]" />
      <div className="relative grid min-h-[560px] items-center gap-8 px-5 py-10 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-12">
        <div>
          <span className="inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-50 ring-1 ring-white/18">
            <Sparkles className="h-4 w-4 text-[#69DFFF]" />
            {restricted ? "客户专属账号体验" : "GEO 全链路操作工具"}
          </span>
          <h2 className="geo-display-title mt-5 max-w-2xl text-3xl leading-tight sm:text-4xl">
            {restricted
              ? "一眼看清自己的现状、变化和执行进度"
              : "从一次检测，到一套能持续执行的增长方案"}
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-cyan-50/72">
            选择一种示例主体，沿着真实工作流程走一遍。所有结果已经准备好，点击即可看到最终会获得什么。
          </p>

          <div className="mt-7">
            <p className="mb-2 text-[11px] font-semibold text-cyan-50/60">选择体验方式</p>
            <div className="grid max-w-lg grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChooseSubject("brand")}
                className={`flex min-h-20 items-center gap-3 rounded-lg border px-4 text-left transition ${
                  subjectType === "brand"
                    ? "border-[#69DFFF] bg-white/16 shadow-[0_12px_30px_-20px_rgba(105,223,255,0.8)]"
                    : "border-white/16 bg-white/6 hover:bg-white/10"
                }`}
              >
                <Building2 className="h-7 w-7 shrink-0 text-[#69DFFF]" />
                <span>
                  <span className="block text-sm font-semibold">品牌模式</span>
                  <span className="mt-1 block text-[10px] text-cyan-50/58">企业、产品、机构</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onChooseSubject("person")}
                className={`flex min-h-20 items-center gap-3 rounded-lg border px-4 text-left transition ${
                  subjectType === "person"
                    ? "border-[#69DFFF] bg-white/16 shadow-[0_12px_30px_-20px_rgba(105,223,255,0.8)]"
                    : "border-white/16 bg-white/6 hover:bg-white/10"
                }`}
              >
                <UserRound className="h-7 w-7 shrink-0 text-[#69DFFF]" />
                <span>
                  <span className="block text-sm font-semibold">个人 IP 模式</span>
                  <span className="mt-1 block text-[10px] text-cyan-50/58">医生、律师、专家</span>
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="border-l border-white/14 pl-0 lg:pl-8">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold text-cyan-50/55">本次示例</p>
              <h3 className="mt-1 text-xl font-semibold">{demo.entityName}</h3>
              <p className="mt-1 text-xs text-cyan-50/65">{demo.industry} · {demo.region}</p>
            </div>
            <span className="rounded-md bg-[#00C8FF]/16 px-2 py-1 text-[10px] font-semibold text-cyan-50 ring-1 ring-[#69DFFF]/30">
              示例主体
            </span>
          </div>
          <div className="space-y-2">
            {deliverables.map((item, index) => (
              <div key={item} className="flex items-start gap-3 border-b border-white/10 py-2.5 last:border-0">
                <span className="geo-data-number flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#1677FF] to-[#00C8FF] text-[10px] font-bold">
                  {index + 1}
                </span>
                <span className="text-xs leading-5 text-cyan-50/82">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function ProfileStep({ demo }: { demo: TutorialDemo }) {
  const isPerson = demo.subjectType === "person"
  return (
    <section className="overflow-hidden rounded-lg border border-[#CFE0F2] bg-white shadow-[0_18px_42px_-34px_rgba(23,59,102,0.55)]">
      <div className="border-b border-[#DCE8F4] bg-gradient-to-r from-[#F4F9FF] to-[#ECF8FF] px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00AEEA] text-white">
            {isPerson ? <UserRound className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">把主体资料集中到一张档案里</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              后续检测、诊断、策略和内容都围绕同一份资料展开。
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
        <DemoField label={isPerson ? "人物姓名" : "品牌名称"} value={demo.entityName} />
        <DemoField label="所在行业" value={demo.industry} />
        <DemoField label="目标区域" value={demo.region} />
        <DemoField label={isPerson ? "其他称呼 / 同名区分" : "品牌别名"} value={demo.aliases.join("、")} />
        <DemoField label="参考网址" value={demo.website} />
        <DemoField label="目标人群" value={demo.audience} />
      </div>

      <div className="border-t border-[#E2ECF5] px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
          <BadgeCheck className="h-4 w-4 text-[#13C2C2]" />
          核心优势资料
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {demo.advantages.map((advantage, index) => (
            <div key={advantage} className="flex items-start gap-2 rounded-lg bg-[#F4F9FF] px-3 py-3 ring-1 ring-[#D7E8F8]">
              <span className="geo-data-number flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#1677FF] text-[10px] font-bold text-white">
                {index + 1}
              </span>
              <span className="text-xs leading-5 text-slate-600">{advantage}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function DemoField({ label, value }: { label: string; value: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[10px] font-semibold text-slate-500">{label}</span>
      <input
        value={value}
        readOnly
        className="h-10 w-full truncate rounded-lg border border-[#C9D9E8] bg-[#F8FBFE] px-3 text-xs font-medium text-slate-700"
      />
    </label>
  )
}

function DetectionStep({
  demo,
  selectedIntent,
  answerRevealed,
  onSelectIntent,
  onRun,
}: {
  demo: TutorialDemo
  selectedIntent: TutorialIntentId
  answerRevealed: boolean
  onSelectIntent: (intent: TutorialIntentId) => void
  onRun: () => void
}) {
  const selected = demo.questions.find(question => question.id === selectedIntent) ?? demo.questions[0]
  return (
    <section className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="rounded-lg border border-[#CFE0F2] bg-white p-3 shadow-[0_16px_38px_-34px_rgba(23,59,102,0.5)]">
        <div className="px-1 pb-2">
          <h2 className="text-sm font-semibold text-slate-900">选择问题意图</h2>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">不同意图对应用户不同的真实决策需求。</p>
        </div>
        <div className="space-y-1.5">
          {demo.questions.map((question, index) => (
            <button
              key={question.id}
              type="button"
              onClick={() => onSelectIntent(question.id)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs font-semibold transition ${
                question.id === selectedIntent
                  ? "bg-gradient-to-r from-[#1677FF] to-[#00AEEA] text-white shadow-sm"
                  : "bg-[#F4F8FC] text-slate-600 hover:bg-[#EAF4FF]"
              }`}
            >
              <span className={`geo-data-number flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] ${
                question.id === selectedIntent ? "bg-white/18" : "bg-white text-[#1677FF]"
              }`}>
                {index + 1}
              </span>
              {question.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#CFE0F2] bg-white shadow-[0_16px_38px_-34px_rgba(23,59,102,0.5)]">
        <div className="border-b border-[#DCE8F4] bg-[#F7FBFF] px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold text-[#1677FF]">{selected.label}</div>
              <h2 className="mt-1 text-base font-semibold leading-6 text-slate-900">{selected.question}</h2>
            </div>
            <span className="shrink-0 rounded-md bg-cyan-50 px-2 py-1 text-[10px] font-semibold text-cyan-700 ring-1 ring-cyan-200">
              联网回答示例
            </span>
          </div>
        </div>

        {!answerRevealed ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center px-5 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00C8FF] text-white shadow-[0_18px_34px_-20px_rgba(22,119,255,0.9)]">
              <Play className="h-6 w-6 fill-current" />
            </span>
            <h3 className="mt-4 text-base font-semibold text-slate-900">运行一次示例检测</h3>
            <p className="mt-2 max-w-md text-xs leading-6 text-slate-500">
              点击后立即展示完整原始回答和可核验信源，帮助你理解实际检测会得到什么。
            </p>
            <button
              type="button"
              onClick={onRun}
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-5 text-xs font-semibold text-white shadow-sm transition hover:brightness-105"
            >
              <SearchCheck className="h-4 w-4" />
              运行示例检测
            </button>
            <span className="mt-3 text-[10px] text-slate-400">立即呈现 · 不消耗积分</span>
          </div>
        ) : (
          <div className="animate-fade-in-up p-4 sm:p-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              示例检测已完成
            </div>
            <div className="mt-3 border-l-2 border-[#1677FF] pl-4">
              <p className="text-sm leading-7 text-slate-700">{selected.answer}</p>
            </div>
            <div className="mt-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <Network className="h-4 w-4 text-[#13C2C2]" />
                回答引用信源
              </div>
              <div className="mt-2 space-y-2">
                {selected.sources.map(source => (
                  <div key={`${source.domain}-${source.title}`} className="flex items-center gap-3 rounded-lg bg-[#F5F9FD] px-3 py-2.5 ring-1 ring-[#DBE8F3]">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-[#1677FF] ring-1 ring-[#D5E5F4]">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-700">{source.title}</span>
                      <span className="mt-0.5 block text-[10px] text-slate-400">{source.platform} · {source.domain}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function ResultsStep({ demo }: { demo: TutorialDemo }) {
  return (
    <section>
      <div className="mb-4 rounded-lg border border-[#91CAFF] bg-gradient-to-r from-[#EAF5FF] to-[#EDFCFF] px-4 py-3">
        <div className="flex items-start gap-3">
          <Radar className="mt-0.5 h-5 w-5 shrink-0 text-[#1677FF]" />
          <div>
            <h2 className="text-sm font-semibold text-[#003EB3]">把模型回答转成一眼能看懂的市场信号</h2>
            <p className="mt-1 text-xs leading-5 text-[#456783]">
              你可以同时看到总体渗透率、行业位置、各模型差异和高频信源平台。
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ResultPanel title="全模型渗透率" subtitle="目标主体在有效回答中的提及情况" icon={Target}>
          <PenetrationDonut
            rate={demo.penetration.rate}
            mentions={demo.penetration.mentions}
            totalSlots={demo.penetration.totalSlots}
          />
        </ResultPanel>
        <ResultPanel title={demo.subjectType === "person" ? "同行人物位置" : "行业竞争位置"} subtitle="同一批问题下的相对位置" icon={Landmark}>
          <BrandRankingCard
            ranking={demo.penetration.ranking}
            totalBrands={demo.penetration.totalEntities}
            perModelRate={demo.penetration.perModelRate}
            topCompetitors={demo.penetration.topCompetitors}
            subjectType={demo.subjectType}
          />
        </ResultPanel>
        <ResultPanel title="各模型渗透率对比" subtitle="识别不同模型中的优势与缺口" icon={BarChart3}>
          <div className="h-[310px] min-h-[310px] w-full">
            <ModelRateTrend
              perModelRate={demo.penetration.perModelRate}
              overallRate={demo.penetration.rate}
              compact
            />
          </div>
        </ResultPanel>
        <ResultPanel title="信源采集平台排名" subtitle="重复引用会累计，帮助判断平台采信概率" icon={Network}>
          <SourcePlatformBars demo={demo} />
        </ResultPanel>
      </div>
    </section>
  )
}

function ResultPanel({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string
  subtitle: string
  icon: typeof Target
  children: React.ReactNode
}) {
  return (
    <article className="min-h-[380px] overflow-hidden rounded-lg border border-[#CFE0F2] bg-white shadow-[0_18px_42px_-36px_rgba(23,59,102,0.6)]">
      <div className="flex items-start gap-3 border-b border-[#E0EAF4] px-4 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00AEEA] text-white">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-[10px] text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </article>
  )
}

function SourcePlatformBars({ demo }: { demo: TutorialDemo }) {
  const maximum = Math.max(...demo.penetration.sourcePlatforms.map(item => item.count), 1)
  const total = demo.penetration.sourcePlatforms.reduce((sum, item) => sum + item.count, 0)
  return (
    <div className="space-y-4 pt-2">
      {demo.penetration.sourcePlatforms.map((platform, index) => (
        <div key={platform.name}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-2 font-semibold text-slate-700">
              <span className="geo-data-number flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#EAF5FF] text-[10px] text-[#1677FF]">
                {index + 1}
              </span>
              <span className="truncate">{platform.name}</span>
            </span>
            <span className="geo-data-number shrink-0 text-[11px] font-semibold text-slate-500">
              {platform.count} 次 · {Math.round(platform.count / total * 100)}%
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-[#E7EEF6]">
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{
                width: `${platform.count / maximum * 100}%`,
                background: `linear-gradient(90deg, ${platform.color}, #00C8FF)`,
              }}
            />
          </div>
        </div>
      ))}
      <p className="border-t border-[#E4EDF5] pt-3 text-[10px] leading-5 text-slate-400">
        同一平台被多个回答重复引用时会累计计数，用于观察真实采信倾向。
      </p>
    </div>
  )
}

function InsightStep({
  demo,
  activeTab,
  onChangeTab,
}: {
  demo: TutorialDemo
  activeTab: InsightTab
  onChangeTab: (tab: InsightTab) => void
}) {
  const tabs: Array<{ key: InsightTab; label: string; icon: typeof Radar }> = [
    { key: "research", label: "独立调研", icon: BookOpenCheck },
    { key: "diagnosis", label: "AI 诊断", icon: Radar },
    { key: "difficulty", label: "难度与成本", icon: Gauge },
  ]

  return (
    <section className="overflow-hidden rounded-lg border border-[#CFE0F2] bg-white shadow-[0_18px_42px_-36px_rgba(23,59,102,0.6)]">
      <div className="border-b border-[#DCE8F4] bg-[#F7FBFF] p-3 sm:p-4">
        <div className="grid grid-cols-3 gap-2">
          {tabs.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => onChangeTab(tab.key)}
                className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-2 text-xs font-semibold transition ${
                  activeTab === tab.key
                    ? "bg-gradient-to-r from-[#1677FF] to-[#00AEEA] text-white shadow-sm"
                    : "bg-white text-slate-600 ring-1 ring-[#D3E1EE] hover:bg-[#EEF6FF]"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.label.replace("独立", "").replace("AI ", "")}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {activeTab === "research" ? (
          <div>
            <SectionHeading
              title="把零散市场信息整理成可执行判断"
              description="快速识别公开信任资产、竞争壁垒和优先补齐方向。"
              icon={BookOpenCheck}
            />
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {demo.research.map((item, index) => (
                <div key={item} className="flex items-start gap-3 rounded-lg bg-[#F5F9FD] px-3 py-3 ring-1 ring-[#DBE8F3]">
                  <span className="geo-data-number flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#13C2C2] to-[#1677FF] text-[10px] font-bold text-white">
                    {index + 1}
                  </span>
                  <p className="text-xs leading-5 text-slate-600">{item}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {activeTab === "diagnosis" ? (
          <div>
            <SectionHeading
              title="把问题拆成明确的优化抓手"
              description="每项结论都对应当前状态、差距和下一步行动。"
              icon={Radar}
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {demo.diagnosis.map(item => (
                <div key={item.label} className="rounded-lg border border-[#D5E4F1] bg-gradient-to-br from-white to-[#F3F9FF] px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-slate-600">{item.label}</span>
                    <span className="geo-data-number text-lg font-bold text-[#0958D9]">{item.value}</span>
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {activeTab === "difficulty" ? (
          <div>
            <SectionHeading
              title="同时看见难度、周期和阶段成本"
              description="先判断项目在哪个难度档位，再按阶段安排内容投入。"
              icon={Gauge}
            />
            <div className="mt-4">
              <DifficultyDimensionsRadial
                dimensions={demo.difficulty.dimensions}
                totalScore={demo.difficulty.totalScore}
                level={demo.difficulty.level}
              />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {demo.difficulty.milestones.map((milestone, index) => (
                <div key={milestone.label} className="rounded-lg border border-[#D5E4F1] bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="geo-data-number flex h-6 w-6 items-center justify-center rounded-md bg-[#EAF5FF] text-[10px] font-bold text-[#1677FF]">
                      {index + 1}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-400">{milestone.period}</span>
                  </div>
                  <h3 className="mt-3 text-xs font-semibold text-slate-800">{milestone.label}</h3>
                  <p className="mt-1.5 text-[11px] text-slate-500">{milestone.content}</p>
                  <p className="geo-data-number mt-2 text-sm font-bold text-[#0958D9]">{milestone.cost}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function SectionHeading({
  title,
  description,
  icon: Icon,
}: {
  title: string
  description: string
  icon: typeof Radar
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00AEEA] text-white">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
    </div>
  )
}

function StrategyStep({
  demo,
  expanded,
  onToggle,
}: {
  demo: TutorialDemo
  expanded: boolean
  onToggle: () => void
}) {
  const visible = expanded ? demo.strategy : demo.strategy.slice(0, 4)
  return (
    <section className="overflow-hidden rounded-lg border border-[#CFE0F2] bg-white shadow-[0_18px_42px_-36px_rgba(23,59,102,0.6)]">
      <div className="flex flex-col gap-3 border-b border-[#DCE8F4] bg-gradient-to-r from-[#F4F9FF] to-[#ECF8FF] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#4096FF] to-[#00C8FF] text-white">
            <ListChecks className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">把检测缺口变成 7 类问题策略</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              每条疑问句在生成后独立匹配优势，并安排更合适的发布渠道。
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-md bg-white px-2.5 py-1 text-[10px] font-semibold text-[#0958D9] ring-1 ring-[#B7D9FF]">
          共 {demo.strategy.length} 类策略
        </span>
      </div>

      <div className="divide-y divide-[#E6EEF6]">
        {visible.map((item, index) => (
          <div key={item.id} className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[72px_minmax(0,1.5fr)_minmax(0,1fr)_170px] lg:items-center">
            <span className="inline-flex w-fit rounded-md bg-[#EAF5FF] px-2 py-1 text-[10px] font-semibold text-[#1677FF]">
              {index + 1}. {item.label}
            </span>
            <p className="text-xs font-semibold leading-5 text-slate-800">{item.question}</p>
            <div className="flex items-start gap-2 text-[11px] leading-5 text-emerald-700">
              <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{item.matchedAdvantage}</span>
            </div>
            <div className="flex items-start gap-2 text-[11px] leading-5 text-slate-500">
              <Layers3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#13C2C2]" />
              <span>{item.channel}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-[#DCE8F4] bg-[#F8FBFE] px-4 py-3 text-center">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#B7D9FF] bg-white px-4 text-xs font-semibold text-[#0958D9] transition hover:bg-[#EAF5FF]"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {expanded ? "收起完整策略" : "显示全部 7 类策略"}
        </button>
      </div>
    </section>
  )
}

function ArticleStep({
  demo,
  generated,
  onGenerate,
}: {
  demo: TutorialDemo
  generated: boolean
  onGenerate: () => void
}) {
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <article className="overflow-hidden rounded-lg border border-[#CFE0F2] bg-white shadow-[0_18px_42px_-36px_rgba(23,59,102,0.6)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#DCE8F4] bg-[#F7FBFF] px-4 py-3.5">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#6C5CE7]" />
            <span className="text-xs font-semibold text-slate-800">Markdown 文章预览</span>
          </div>
          <span className="rounded-md bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200">
            示例稿
          </span>
        </div>
        <div className="p-5 sm:p-7">
          <h2 className="geo-display-title text-2xl leading-tight text-slate-950">{demo.article.title}</h2>
          <p className="mt-4 text-sm leading-7 text-slate-600">{demo.article.introduction}</p>
          <h3 className="mt-6 border-l-3 border-[#1677FF] pl-3 text-base font-semibold text-slate-900">
            {demo.article.sectionTitle}
          </h3>
          <div className="mt-3 space-y-2">
            {demo.article.paragraphs.map(paragraph => (
              <p key={paragraph} className="text-sm leading-7 text-slate-600">{paragraph}</p>
            ))}
          </div>
          <div className="mt-6 overflow-x-auto rounded-lg border border-[#D5E4F1]">
            <table className="w-full min-w-[520px] border-collapse text-left text-xs">
              <thead className="bg-[#EAF5FF] text-[#0958D9]">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">典型场景</th>
                  <th className="px-3 py-2.5 font-semibold">建议选择</th>
                  <th className="px-3 py-2.5 font-semibold">判断依据</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5EDF5] text-slate-600">
                {demo.article.rows.map(row => (
                  <tr key={row.scene}>
                    <td className="px-3 py-2.5 font-semibold text-slate-700">{row.scene}</td>
                    <td className="px-3 py-2.5">{row.choice}</td>
                    <td className="px-3 py-2.5">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </article>

      <aside className="rounded-lg border border-[#CFE0F2] bg-white p-4 shadow-[0_18px_42px_-36px_rgba(23,59,102,0.6)]">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#6C5CE7] to-[#1677FF] text-white">
            <WandSparkles className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">批量生成独立文章</h2>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              每篇单独生成并自动整理为 Word 文档。
            </p>
          </div>
        </div>

        {!generated ? (
          <button
            type="button"
            onClick={onGenerate}
            className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#6C5CE7] to-[#1677FF] text-xs font-semibold text-white shadow-sm transition hover:brightness-105"
          >
            <Play className="h-4 w-4 fill-current" />
            模拟生成 3 篇
          </button>
        ) : (
          <div className="mt-5 animate-fade-in-up">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              3 篇已生成并保存
            </div>
            <div className="mt-3 space-y-2">
              {demo.article.files.map((file, index) => (
                <div key={file} className="flex items-center gap-2 rounded-lg bg-[#F5F9FD] px-3 py-2.5 ring-1 ring-[#DBE8F3]">
                  <FileCheck2 className="h-4 w-4 shrink-0 text-[#1677FF]" />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-600">{file}</span>
                  <span className="geo-data-number text-[10px] text-emerald-600">{index + 1}/3</span>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#B7D9FF] bg-[#EAF5FF] text-xs font-semibold text-[#0958D9]"
            >
              <Download className="h-4 w-4" />
              一键下载全部
            </button>
          </div>
        )}

        <div className="mt-5 border-t border-[#E1EAF3] pt-4">
          <p className="text-[10px] font-semibold text-slate-400">你还可以</p>
          <div className="mt-2 space-y-2 text-[11px] text-slate-600">
            <div className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-[#13C2C2]" />选择国内外模型</div>
            <div className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-[#13C2C2]" />读取信源链接进行改写</div>
            <div className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-[#13C2C2]" />进入 Markdown 排版工作区</div>
          </div>
        </div>
      </aside>
    </section>
  )
}

function DeliveryStep({
  demo,
  restricted,
}: {
  demo: TutorialDemo
  restricted: boolean
}) {
  const cards = restricted
    ? [
        { icon: Target, label: "检测历史", value: "查看每次渗透率与竞品变化", color: "from-[#1677FF] to-[#00AEEA]" },
        { icon: CalendarDays, label: "执行反馈", value: "按周、按月查看已完成动作", color: "from-[#13C2C2] to-[#1677FF]" },
        { icon: Network, label: "在线报告", value: "打开来源与原始回答进行核验", color: "from-[#2F54EB] to-[#6C5CE7]" },
      ]
    : [
        { icon: FileCheck2, label: "专业 PDF", value: "图表、结论和建议自动整合", color: "from-[#1677FF] to-[#00AEEA]" },
        { icon: CalendarDays, label: "周报与月报", value: "动作、效果和阶段进度连贯呈现", color: "from-[#13C2C2] to-[#1677FF]" },
        { icon: Network, label: "客户在线报告", value: "链接可核验，支持专属账号查看", color: "from-[#2F54EB] to-[#6C5CE7]" },
      ]

  return (
    <section className="overflow-hidden rounded-lg border border-[#CFE0F2] bg-white shadow-[0_18px_42px_-36px_rgba(23,59,102,0.6)]">
      <div className="relative overflow-hidden bg-[#001D66] px-5 py-8 text-white sm:px-8">
        <DiamondStarfield />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,rgba(0,29,102,0.98),rgba(0,62,179,0.88),rgba(0,174,234,0.68))]" />
        <div className="relative max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1.5 text-[10px] font-semibold text-cyan-50 ring-1 ring-white/18">
            <BadgeCheck className="h-3.5 w-3.5" />
            完整体验已完成
          </span>
          <h2 className="geo-display-title mt-4 text-2xl sm:text-3xl">
            {restricted ? "客户看到的不只是结论，更有可核验的过程" : "把每次分析沉淀成专业、可信、可持续的交付"}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-cyan-50/72">
            {restricted
              ? `进入工作台后，可以查看「${accessSafeName(demo.entityName)}」的检测记录、在线反馈和最新执行进度。`
              : "历史检测、专业报告、内容资产与执行反馈都会持续保留，换设备登录也能继续查看。"}
          </p>
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:p-5 md:grid-cols-3">
        {cards.map(card => {
          const Icon = card.icon
          return (
            <div key={card.label} className="rounded-lg border border-[#D6E4F1] bg-gradient-to-br from-white to-[#F4F9FF] px-4 py-4">
              <span className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${card.color} text-white`}>
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-3 text-sm font-semibold text-slate-900">{card.label}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">{card.value}</p>
            </div>
          )
        })}
      </div>

      <div className="border-t border-[#E0EAF4] bg-[#F8FBFE] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">现在可以进入真实工作台</p>
              <p className="mt-1 text-[11px] text-slate-500">
                教程以后仍可从右上角账号菜单重新打开。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-400">
            <CircleDollarSign className="h-4 w-4 text-[#13C2C2]" />
            本次体验未消耗积分
          </div>
        </div>
      </div>
    </section>
  )
}

function accessSafeName(value: string): string {
  return value.trim() || "关联主体"
}
