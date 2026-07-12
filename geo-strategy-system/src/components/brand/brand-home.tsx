import Image from "next/image"
import Link from "next/link"
import {
  ArrowRight,
  BarChart3,
  Bot,
  FileSearch,
  FileText,
  Gauge,
  KeyRound,
  SearchCheck,
  Sparkles,
  Target,
  UserPlus,
} from "lucide-react"
import SiteFooter from "@/components/site-footer"
import type { PublicUser } from "@/lib/auth"

type BrandHomeProps = {
  user: Pick<PublicUser, "name" | "role"> | null
}

const CAPABILITIES = [
  { label: "渗透率情报", meta: "品牌可见度", Icon: Target },
  { label: "独立调研", meta: "行业与竞品", Icon: SearchCheck },
  { label: "AI 诊断", meta: "多维度判断", Icon: Bot },
  { label: "难度测评", meta: "投入与周期", Icon: Gauge },
  { label: "关键词策略", meta: "需求与问题", Icon: BarChart3 },
  { label: "文章生成", meta: "策略到内容", Icon: FileText },
]

const OUTCOMES = [
  {
    title: "看见",
    description: "识别品牌在主流 AI 回答中的真实提及、竞品排名与引用信源。",
  },
  {
    title: "判断",
    description: "把联网盲测、品牌声量与关键词竞争整合为可比较的市场信号。",
  },
  {
    title: "行动",
    description: "从问题池、优势匹配到商业报告与内容生成，形成连续的 GEO 路径。",
  },
]

export default function BrandHome({ user }: BrandHomeProps) {
  const primaryHref = user ? "/workspace" : "/sign-in?redirect_url=/"
  const primaryLabel = user ? "进入 GEO 工作台" : "登录使用"

  return (
    <div className="min-h-screen bg-[#F5F9FF] text-[#102A43]">
      <section className="relative min-h-[calc(100svh-72px)] overflow-hidden bg-[#001D66] text-white">
        <div className="absolute inset-y-0 right-0 w-[12%] bg-gradient-to-b from-[#00C8FF] via-[#1677FF] to-[#2F54EB]" aria-hidden="true" />
        <div className="absolute inset-y-0 right-[12%] w-px bg-white/16" aria-hidden="true" />
        <div className="brand-entry-watermark absolute -right-[28%] top-[12%] h-[46%] w-[76%] md:-right-[5%] md:top-[4%] md:h-[82%] md:w-[62%]" aria-hidden="true">
          <Image
            src="/brand/shitu-canvas.jpg"
            alt=""
            fill
            priority
            sizes="(max-width: 768px) 90vw, 62vw"
            className="object-contain object-right"
          />
        </div>

        <header className="relative z-20 border-b border-white/12">
          <nav className="mx-auto flex h-[76px] max-w-7xl items-center justify-between gap-4 px-4 md:px-8" aria-label="主导航">
            <Link href="/" className="inline-flex min-w-0 items-center gap-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
              <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-white ring-1 ring-white/30">
                <Image
                  src="/brand/shitu-lockup.jpg"
                  alt="势途"
                  width={840}
                  height={960}
                  className="h-[118%] w-full object-cover object-top"
                />
              </span>
              <span className="min-w-0">
                <span className="geo-brand-title block truncate text-lg text-white">SHITU · 势途 GEO</span>
                <span className="hidden text-[10px] font-medium uppercase text-white/50 sm:block">
                  Generative Engine Intelligence
                </span>
              </span>
            </Link>

            <div className="flex shrink-0 items-center gap-2">
              {user ? (
                <>
                  {user.role === "admin" ? (
                    <Link
                      href="/admin"
                      className="hidden h-9 items-center px-3 text-xs font-medium text-white/70 transition-colors hover:text-white sm:inline-flex"
                    >
                      管理后台
                    </Link>
                  ) : null}
                  <Link
                    href="/workspace"
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-white px-3.5 text-sm font-semibold text-[#062B57] transition-colors hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  >
                    <span className="hidden sm:inline">进入工作台</span>
                    <span className="sm:hidden">进入</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/sign-in?redirect_url=/"
                    className="inline-flex h-9 items-center px-2.5 text-sm font-medium text-white/75 transition-colors hover:text-white"
                  >
                    登录
                  </Link>
                  <Link
                    href="/sign-up?redirect_url=/"
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-white px-3.5 text-sm font-semibold text-[#062B57] transition-colors hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  >
                    注册账号
                    <ArrowRight className="hidden h-4 w-4 sm:block" />
                  </Link>
                </>
              )}
            </div>
          </nav>
        </header>

        <div className="relative z-10 mx-auto flex min-h-[calc(100svh-148px)] max-w-7xl items-center px-4 pb-24 pt-12 md:px-8 md:pb-36 md:pt-16">
          <div className="brand-entry-reveal max-w-4xl">
            <div className="mb-7 flex items-center gap-3 text-[11px] font-semibold uppercase text-cyan-200/85">
              <span className="h-px w-12 bg-[#00C8FF]" />
              SHITU GEO Intelligence
            </div>
            <h1 className="geo-display-title text-5xl leading-[1.08] text-white sm:text-6xl md:text-8xl">
              势途 GEO
            </h1>
            <p className="geo-display-title mt-5 text-2xl leading-snug text-cyan-100 sm:text-3xl md:text-4xl">
              让品牌成为 AI 的答案
            </p>
            <p className="mt-6 max-w-2xl text-sm leading-7 text-white/66 sm:text-base">
              面向主流大模型的品牌可见度与生成式搜索增长平台。用真实联网回答看清市场，把判断转化为可执行的 GEO 路径。
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href={primaryHref}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#1677FF] to-[#00C8FF] px-5 text-sm font-semibold text-white shadow-[0_16px_34px_-20px_rgba(0,200,255,0.72)] transition-[filter,box-shadow] hover:brightness-105 hover:shadow-[0_18px_38px_-20px_rgba(22,119,255,0.78)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
              >
                {user ? <Sparkles className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              {user ? (
                <div className="inline-flex min-w-0 items-center gap-2 text-sm text-white/60">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                  <span className="truncate">已识别账号：{user.name}</span>
                </div>
              ) : (
                <Link
                  href="/sign-up?redirect_url=/"
                  className="inline-flex h-12 items-center justify-center gap-2 px-4 text-sm font-medium text-white/74 transition-colors hover:text-white"
                >
                  <UserPlus className="h-4 w-4" />
                  创建账号
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 z-20 border-t border-white/12 bg-[#001A4F]/96">
          <div className="mx-auto grid max-w-7xl grid-cols-3 px-4 md:grid-cols-6 md:px-8">
              {CAPABILITIES.map(({ label, meta, Icon }, index) => (
                <div
                  key={label}
                  className={`flex min-h-[52px] items-center gap-2 px-2 py-2 sm:min-h-[72px] sm:gap-2.5 sm:px-4 sm:py-3 ${index % 3 > 0 ? "border-l border-white/10" : ""} ${index >= 3 ? "border-t border-white/10 md:border-t-0" : ""} ${index > 0 && index % 3 === 0 ? "md:border-l md:border-white/10" : ""}`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-cyan-300 sm:h-4 sm:w-4" />
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-semibold text-white sm:text-sm">{label}</span>
                    <span className="mt-0.5 hidden truncate text-[10px] text-white/42 lg:block">{meta}</span>
                  </span>
                </div>
              ))}
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-r from-[#003EB3] via-[#1677FF] to-[#00C8FF] text-white">
        <div className="mx-auto flex min-h-[72px] max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-8">
          <p className="text-sm font-medium sm:text-base">
            从 AI 原始回答出发，看见品牌在生成式搜索中的真实位置。
          </p>
          <FileSearch className="hidden h-5 w-5 shrink-0 text-cyan-100 sm:block" />
        </div>
      </section>

      <section className="bg-[#F5F9FF] py-16 md:py-24" aria-labelledby="workspace-preview-title">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <div className="max-w-3xl">
            <div className="text-[11px] font-semibold uppercase text-[#1677FF]">Real workspace</div>
            <h2 id="workspace-preview-title" className="geo-display-title mt-3 text-3xl leading-tight text-[#102A43] sm:text-4xl md:text-5xl">
              从疑问句，到可执行的增长判断
            </h2>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
              一套工作台整合多模型联网检测、品牌声量、竞争难度、问题策略与内容生成，让每一次检测都能形成下一步行动。
            </p>
          </div>

          <div className="mt-10 overflow-hidden rounded-lg border border-[#C9DEFF] bg-white shadow-[0_30px_70px_-50px_rgba(9,88,217,0.48)]">
            <div className="flex h-10 items-center gap-2 border-b border-[#1D4FA3] bg-[#001D66] px-4">
              <span className="h-2 w-2 rounded-full bg-[#FF5B6E]" />
              <span className="h-2 w-2 rounded-full bg-[#00C8FF]" />
              <span className="h-2 w-2 rounded-full bg-[#16C79A]" />
              <span className="ml-2 text-[10px] font-medium text-white/45">shitugeo.top / workspace · 演示数据</span>
            </div>
            <div className="relative aspect-[16/9] bg-[#EAF3FF]">
              <Image
                src="/brand/workspace-preview.png"
                alt="势途 GEO 真实工作台界面"
                fill
                loading="eager"
                sizes="(max-width: 768px) 100vw, 1200px"
                className="object-cover object-top"
              />
            </div>
          </div>

          <div className="mt-12 grid border-y border-[#C9DEFF] md:grid-cols-3">
            {OUTCOMES.map((outcome, index) => (
              <div
                key={outcome.title}
                className={`py-7 md:px-7 ${index > 0 ? "border-t border-[#C9DEFF] md:border-l md:border-t-0" : ""}`}
              >
                <div className="geo-display-title text-2xl text-[#003EB3]">{outcome.title}</div>
                <p className="mt-3 text-sm leading-6 text-slate-600">{outcome.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-r from-[#2F54EB] via-[#1677FF] to-[#00C8FF] text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 py-12 sm:flex-row sm:items-center md:px-8 md:py-14">
          <div>
            <div className="text-[11px] font-semibold uppercase text-cyan-100/75">AI visibility is market visibility</div>
            <h2 className="geo-display-title mt-2 max-w-3xl text-2xl leading-snug text-white sm:text-3xl">
              品牌是否会被 AI 看见与推荐，正在成为新的市场份额。
            </h2>
          </div>
          <Link
            href={primaryHref}
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-md bg-white px-5 text-sm font-semibold text-[#062B57] transition-colors hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {primaryLabel}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <SiteFooter className="bg-white" />
    </div>
  )
}
