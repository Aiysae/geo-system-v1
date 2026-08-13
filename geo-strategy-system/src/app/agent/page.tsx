import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowRight,
  Bot,
  Check,
  CircleGauge,
  FileText,
  KeyRound,
  Layers3,
  LockKeyhole,
  Route,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from "lucide-react"
import { AGENT_INTEGRATIONS } from "@/lib/agent/integration-catalog"

export const metadata: Metadata = {
  title: "Agent 接入说明 · 势途 GEO",
  description: "将 Codex、Claude、Cursor 或自建 Agent 安全接入势途 GEO 全链路操作工具。",
}

const CAPABILITIES = [
  { icon: CircleGauge, title: "分析与自动监测", detail: "渗透率、定时检测、独立调研、AI 诊断与难度测评" },
  { icon: Layers3, title: "策略与内容生产", detail: "关键词、AI 裁判选稿、改写、批量文章与自动配图" },
  { icon: FileText, title: "资料与客户交付", detail: "资料审核、执行反馈、分享链接、历史产出与专业报告" },
  { icon: Route, title: "后台持续执行", detail: "切换页面或设备不中断任务" },
] as const

export default function AgentGuidePage() {
  const actionHref = "/account/agents"
  return (
    <div className="min-h-screen bg-[#F3F8FE] text-slate-950">
      <header className="border-b border-[#CFE4FA] bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="返回势途 GEO 首页">
            <Image src="/brand/shitu-lockup-transparent-v2.png" alt="势途 GEO" width={150} height={45} className="h-9 w-auto object-contain" priority />
          </Link>
          <Link href={actionHref} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#1677FF] px-3 text-xs font-bold text-white shadow-sm shadow-blue-500/20">
            打开接入中心<ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden bg-[#001D66] text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_20%,rgba(0,174,234,.55),transparent_27%),radial-gradient(circle_at_62%_85%,rgba(22,119,255,.5),transparent_32%)]" />
          <div className="relative mx-auto grid min-h-[440px] max-w-7xl items-center gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.05fr_.95fr] lg:py-16">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-bold text-cyan-200"><Sparkles className="h-4 w-4" />GEO 全链路操作工具</div>
              <h1 className="mt-5 max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">让你的 Agent<br />直接操作势途 GEO</h1>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-blue-100/80 sm:text-base">选择 Agent、授权客户、复制配置并测试连接。正式任务使用与网页端相同的权限、积分和历史记录。</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href={actionHref} className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-5 text-sm font-bold text-[#0958D9] shadow-lg shadow-blue-950/20"><Bot className="h-4 w-4" />开始接入</Link>
                <a href="/api/agent/v1/openapi.json" target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-lg border border-white/25 bg-white/10 px-5 text-sm font-semibold text-white backdrop-blur"><TerminalSquare className="h-4 w-4" />OpenAPI</a>
              </div>
            </div>
            <div className="relative mx-auto w-full max-w-lg" aria-hidden="true">
              <div className="absolute left-8 right-8 top-1/2 h-px bg-gradient-to-r from-transparent via-cyan-300 to-transparent" />
              <div className="relative grid grid-cols-2 gap-3">
                {[Bot, KeyRound, ShieldCheck, Check].map((Icon, index) => (
                  <div key={index} className="flex min-h-32 items-center justify-center border border-white/15 bg-white/[.08] backdrop-blur-md">
                    <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-cyan-300/15 text-cyan-200 ring-1 ring-cyan-200/30"><Icon className="h-6 w-6" /></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-[#D8E7F7] bg-white">
          <div className="mx-auto grid max-w-7xl divide-y divide-[#D8E7F7] px-4 sm:px-6 md:grid-cols-3 md:divide-x md:divide-y-0">
            {["1  选择 Agent", "2  创建专属密钥", "3  测试后开始工作"].map(item => <div key={item} className="px-4 py-5 text-sm font-bold text-slate-700 first:pl-0 last:pr-0">{item}</div>)}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <div className="max-w-2xl"><p className="text-xs font-bold text-[#1677FF]">AGENT 能力</p><h2 className="mt-2 text-2xl font-bold">一次接入，持续执行</h2></div>
          <div className="mt-7 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map(item => <article key={item.title} className="rounded-lg border border-[#D8E7F7] bg-white p-5 shadow-sm"><item.icon className="h-5 w-5 text-[#1677FF]" /><h3 className="mt-4 text-sm font-bold">{item.title}</h3><p className="mt-2 text-xs leading-5 text-slate-500">{item.detail}</p></article>)}
          </div>
        </section>

        <section className="bg-white py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <p className="text-xs font-bold text-[#1677FF]">支持的接入方式</p>
            <div className="mt-5 grid gap-x-8 border-y border-[#D8E7F7] sm:grid-cols-2 lg:grid-cols-3">
              {AGENT_INTEGRATIONS.map(item => <div key={item.key} className="flex min-h-28 gap-3 border-b border-[#E8F1FA] py-5"><span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EAF4FF] text-[#0958D9]"><Bot className="h-4 w-4" /></span><div><h3 className="text-sm font-bold">{item.label}</h3><p className="mt-1.5 text-xs leading-5 text-slate-500">{item.description}</p></div></div>)}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <div className="grid items-center gap-8 rounded-lg bg-[#071E41] px-6 py-8 text-white md:grid-cols-[auto_1fr_auto]">
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-cyan-300/10 text-cyan-200"><LockKeyhole className="h-6 w-6" /></span>
            <div><h2 className="text-lg font-bold">权限、积分和客户范围始终可控</h2><p className="mt-2 text-xs leading-5 text-blue-100/70">Agent 不能越过账号权限，密钥可设置预算、IP 白名单和到期时间，并可随时撤销。</p></div>
            <Link href={actionHref} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#15C8FF] px-4 text-xs font-bold text-[#071E41]">进入接入中心<ArrowRight className="h-4 w-4" /></Link>
          </div>
        </section>
      </main>
    </div>
  )
}
