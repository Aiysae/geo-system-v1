import Image from "next/image"
import Link from "next/link"
import {
  ArrowRight,
  BarChart3,
  Bot,
  Diamond,
  FileSearch,
  FileText,
  Gauge,
  KeyRound,
  SearchCheck,
  Sparkles,
  Target,
  UserPlus,
} from "lucide-react"
import DiamondStarfield from "@/components/brand/diamond-starfield"
import SiteFooter from "@/components/site-footer"
import type { PublicUser } from "@/lib/auth"

type BrandHomeProps = {
  user: Pick<PublicUser, "name" | "role"> | null
}

const CAPABILITIES = [
  { label: "渗透率情报", meta: "品牌可见度", Icon: Target, tone: "text-[#8BE9FF]" },
  { label: "独立调研", meta: "行业与竞品", Icon: SearchCheck, tone: "text-[#53D6FF]" },
  { label: "AI 诊断", meta: "多维度判断", Icon: Bot, tone: "text-[#69AFFF]" },
  { label: "难度测评", meta: "投入与周期", Icon: Gauge, tone: "text-[#91CAFF]" },
  { label: "关键词策略", meta: "需求与问题", Icon: BarChart3, tone: "text-[#2FE1D0]" },
  { label: "文章生成", meta: "策略到内容", Icon: FileText, tone: "text-[#A8C8FF]" },
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

function BrandSymbol() {
  return (
    <span className="brand-symbol-cutout relative block h-10 w-10 shrink-0 overflow-hidden" aria-hidden="true">
      <Image
        src="/brand/shitu-lockup-transparent-v2.png"
        alt=""
        width={1173}
        height={1373}
        priority
        className="brand-symbol-image absolute max-w-none"
      />
    </span>
  )
}

export default function BrandHome({ user }: BrandHomeProps) {
  const primaryHref = user ? "/workspace" : "/sign-in?redirect_url=/"
  const primaryLabel = user ? "进入 GEO 工作台" : "登录使用"

  return (
    <div className="min-h-screen bg-[#F7FBFF] text-[#102A43]">
      <section className="relative overflow-hidden bg-[#020B2D] text-white">
        <Image
          src="/brand/blue-diamond-hero-v2.png"
          alt="蓝钻折射形成的势途 GEO 品牌主视觉"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[38%_center] md:object-center"
        />
        <div className="brand-diamond-shade absolute inset-0" aria-hidden="true" />
        <DiamondStarfield />

        <header className="relative z-30 border-b border-cyan-200/15 bg-[#020B2D]/38 backdrop-blur-xl">
          <nav className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-4 px-4 md:h-[76px] md:px-8" aria-label="主导航">
            <Link href="/" className="inline-flex min-w-0 items-center gap-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BE9FF]">
              <BrandSymbol />
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold text-white sm:text-lg">SHITU · 势途 GEO</span>
                <span className="hidden text-[10px] font-medium uppercase text-[#8BE9FF]/62 sm:block">
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
                      className="hidden h-9 items-center px-3 text-xs font-medium text-white/68 transition-colors hover:text-white sm:inline-flex"
                    >
                      管理后台
                    </Link>
                  ) : null}
                  <Link
                    href="/workspace"
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-cyan-100/30 bg-white px-3.5 text-sm font-semibold text-[#052B66] shadow-[0_12px_34px_-18px_rgba(0,207,255,0.8)] transition-colors hover:bg-[#EAF8FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BE9FF]"
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
                    className="inline-flex h-9 items-center px-2.5 text-sm font-medium text-white/72 transition-colors hover:text-white"
                  >
                    登录
                  </Link>
                  <Link
                    href="/sign-up?redirect_url=/"
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-cyan-100/30 bg-white px-3.5 text-sm font-semibold text-[#052B66] shadow-[0_12px_34px_-18px_rgba(0,207,255,0.8)] transition-colors hover:bg-[#EAF8FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BE9FF]"
                  >
                    注册账号
                    <ArrowRight className="hidden h-4 w-4 sm:block" />
                  </Link>
                </>
              )}
            </div>
          </nav>
        </header>

        <div className="brand-hero-stage relative z-10 mx-auto flex max-w-7xl items-center px-4 py-8 md:px-8 md:py-12">
          <div className="brand-entry-reveal max-w-[720px]">
            <div className="mb-5 flex items-center gap-3 text-[11px] font-semibold uppercase text-[#8BE9FF]/88 sm:mb-6">
              <Diamond className="h-4 w-4 fill-[#00CFFF]/18 text-[#8BE9FF]" />
              SHITU GEO Intelligence
              <span className="h-px w-10 bg-gradient-to-r from-[#00CFFF] to-transparent sm:w-16" />
            </div>
            <h1 className="text-5xl font-semibold leading-[1.04] text-white sm:text-6xl lg:text-7xl">
              势途 GEO
            </h1>
            <p className="mt-4 text-2xl font-semibold leading-snug text-[#DDF7FF] sm:mt-5 sm:text-3xl lg:text-4xl">
              让品牌成为 AI 的答案
            </p>
            <p className="mt-4 text-sm font-semibold text-[#8BE9FF] sm:text-base">
              GEO 全链路操作工具
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[#C8DFFF]/76 sm:text-base">
              面向主流大模型的品牌可见度与生成式搜索增长平台。用真实联网回答看清市场，把判断转化为可执行的 GEO 路径。
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:mt-9 sm:flex-row sm:items-center">
              <Link
                href={primaryHref}
                className="brand-diamond-action inline-flex h-12 items-center justify-center gap-2 overflow-hidden rounded-lg px-5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BE9FF]"
              >
                {user ? <Sparkles className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              {user ? (
                <Link
                  href="#workspace-preview-title"
                  className="inline-flex h-12 items-center justify-center gap-2 px-3 text-sm font-medium text-white/72 transition-colors hover:text-white"
                >
                  查看平台能力
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <Link
                  href="/sign-up?redirect_url=/"
                  className="inline-flex h-12 items-center justify-center gap-2 px-3 text-sm font-medium text-white/72 transition-colors hover:text-white"
                >
                  <UserPlus className="h-4 w-4" />
                  创建账号
                </Link>
              )}
            </div>

            {user ? (
              <div className="mt-4 inline-flex min-w-0 items-center gap-2 text-xs text-[#C8DFFF]/68">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#13D9A0] shadow-[0_0_12px_rgba(19,217,160,0.85)]" />
                <span className="truncate">已识别账号：{user.name}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="relative z-20 border-t border-cyan-200/15 bg-[#020F38]/72 backdrop-blur-xl">
          <div className="mx-auto grid max-w-7xl grid-cols-3 px-4 md:px-8 lg:grid-cols-6">
            {CAPABILITIES.map(({ label, meta, Icon, tone }, index) => (
              <div
                key={label}
                className={`flex min-h-[52px] items-center gap-2 px-2 py-2 sm:min-h-[72px] sm:gap-2.5 sm:px-4 sm:py-3 ${index % 3 > 0 ? "border-l border-white/10" : ""} ${index >= 3 ? "border-t border-white/10 lg:border-t-0" : ""} ${index > 0 ? "lg:border-l lg:border-white/10" : ""}`}
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4 ${tone}`} />
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-semibold text-white sm:text-sm">{label}</span>
                  <span className="mt-0.5 hidden truncate text-[10px] text-[#C8DFFF]/46 lg:block">{meta}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="brand-signal-band text-white">
        <div className="mx-auto flex min-h-[72px] max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-8">
          <p className="text-sm font-medium sm:text-base">
            从 AI 原始回答出发，看见品牌在生成式搜索中的真实位置。
          </p>
          <FileSearch className="hidden h-5 w-5 shrink-0 text-[#8BE9FF] sm:block" />
        </div>
      </section>

      <section className="bg-[#F7FBFF] py-16 md:py-24" aria-labelledby="workspace-preview-title">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <div className="max-w-3xl">
            <div className="text-[11px] font-semibold uppercase text-[#1677FF]">Real workspace</div>
            <h2 id="workspace-preview-title" className="mt-3 text-3xl font-semibold leading-tight text-[#102A43] sm:text-4xl md:text-5xl">
              从疑问句，到可执行的增长判断
            </h2>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
              一套工作台整合多模型联网检测、品牌声量、竞争难度、问题策略与内容生成，让每一次检测都能形成下一步行动。
            </p>
          </div>

          <div className="mt-10 overflow-hidden rounded-lg border border-[#B7D7FF] bg-white shadow-[0_34px_80px_-52px_rgba(3,55,166,0.58)]">
            <div className="flex h-10 items-center gap-2 border-b border-[#2266C8] bg-[#031E62] px-4">
              <span className="h-2 w-2 rounded-full bg-[#FF5B6E]" />
              <span className="h-2 w-2 rounded-full bg-[#00CFFF]" />
              <span className="h-2 w-2 rounded-full bg-[#13D9A0]" />
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

          <div className="mt-12 grid border-y border-[#B7D7FF] md:grid-cols-3">
            {OUTCOMES.map((outcome, index) => (
              <div
                key={outcome.title}
                className={`py-7 md:px-7 ${index > 0 ? "border-t border-[#B7D7FF] md:border-l md:border-t-0" : ""}`}
              >
                <div className="text-2xl font-semibold text-[#0637A6]">{outcome.title}</div>
                <p className="mt-3 text-sm leading-6 text-slate-600">{outcome.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="brand-final-cta text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 py-12 sm:flex-row sm:items-center md:px-8 md:py-14">
          <div>
            <div className="text-[11px] font-semibold uppercase text-[#BCEEFF]/75">AI visibility is market visibility</div>
            <h2 className="mt-2 max-w-3xl text-2xl font-semibold leading-snug text-white sm:text-3xl">
              品牌是否会被 AI 看见与推荐，正在成为新的市场份额。
            </h2>
          </div>
          <Link
            href={primaryHref}
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-[#052B66] shadow-[0_14px_36px_-22px_rgba(139,233,255,0.9)] transition-colors hover:bg-[#EAF8FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
