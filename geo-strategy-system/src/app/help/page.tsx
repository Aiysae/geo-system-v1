import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowRight,
  BookOpenCheck,
  CircleHelp,
  Clock3,
  FileText,
  MessageSquareText,
  UsersRound,
  WalletCards,
} from "lucide-react"
import SiteFooter from "@/components/site-footer"

const SITE_URL = "https://shitugeo.top"
const UPDATED_AT = "2026-08-08"

export const metadata: Metadata = {
  title: "帮助与使用说明 · 势途 GEO",
  description: "势途 GEO 网站说明、快速开始、七个功能模块、客户协作、积分报告与常见问题。",
  alternates: { canonical: `${SITE_URL}/help` },
}

const modules = [
  {
    id: "module-penetration",
    title: "渗透率情报",
    purpose: "用多个 AI 模型独立联网回答同一批真实问题，查看品牌或个人 IP 的提及、竞品、信源和可见度。",
    steps: ["选择客户并补充品牌或个人 IP 信息", "输入疑问句并选择检测模型", "提交后可离开页面，任务会在后台继续", "完成后从消息中心或历史报告查看结果"],
    output: "原始联网回答、引用网址、品牌声量、关键词热度、模型对比和专业报告。",
  },
  {
    id: "module-research",
    title: "独立调研",
    purpose: "围绕客户、行业与竞争环境形成结构化研究，补充后续策略需要的事实基础。",
    steps: ["确认调研对象和行业范围", "补充已有资料与重点关注方向", "生成调研后核对关键事实", "保存结果或导出专业报告"],
    output: "行业现状、竞争关系、机会判断、风险提示和研究结论。",
  },
  {
    id: "module-diagnosis",
    title: "AI 诊断",
    purpose: "检查网站和品牌资料是否容易被 AI 发现、理解、引用和验证。",
    steps: ["填写可访问的网站地址", "启动真实网站诊断", "查看标题结构、问答、robots、llms.txt 与可信度表现", "按优先级完成改进"],
    output: "诊断分数、问题证据、影响说明和可执行修复建议。",
  },
  {
    id: "module-difficulty",
    title: "难度测评",
    purpose: "评估进入目标行业和区域后，建立 AI 稳定提及所需的竞争难度、周期、内容量与预算。",
    steps: ["填写行业、区域和业务资料", "确认竞争对象与高敏感属性", "生成七维难度评估", "查看分阶段成本和执行量"],
    output: "七维评分、难度等级、预计周期、阶段目标、内容数量和执行成本。",
  },
  {
    id: "module-keyword",
    title: "关键词策略",
    purpose: "把客户资料转成可执行的关键词、用户疑问句、优势匹配和平台发布策略。",
    steps: ["上传或填写客户资料", "生成并确认关键词策略", "按意图生成疑问句并匹配优势", "导出 Word、表格或 PDF 策略报告"],
    output: "关键词体系、疑问句池、优势匹配、平台策略和内容执行建议。",
  },
  {
    id: "module-article",
    title: "文章生成",
    purpose: "根据客户知识资料、疑问句、优势和文章方法生成或改写可交付内容。",
    steps: ["选择文章类型和模型", "填写品牌资料或导入疑问句与优势", "单篇、批量或自动成文", "人工复核后下载 Word 文档"],
    output: "Markdown 正文、质量检查结果以及可单独或批量下载的 Word 文档。",
  },
  {
    id: "module-feedback",
    title: "执行反馈",
    purpose: "持续记录已经完成的发布、优化、检测和沟通动作，形成客户可核验的周报与月报。",
    steps: ["设置正式执行日期", "每天录入动作或批量导入证据网址", "选择哪些动作对客户可见", "生成并发布周报或月报"],
    output: "动作日历、证据链接、阶段进度、前后效果对比和客户反馈报告。",
  },
]

const faqs = [
  { q: "提交任务后可以切换客户或退出页面吗？", a: "可以。已提交的检测、生成和报告任务会在后台继续，完成后会进入任务中心或消息中心。" },
  { q: "为什么切换客户后看到的内容不同？", a: "每个客户拥有独立资料、输入草稿和结果。请先确认工作台左上角显示的是正确客户。" },
  { q: "哪些信息会在其他设备同步？", a: "系统生成的历史结果、报告、客户资料和正式执行记录会保存在云端。尚未提交的临时输入以当前设备草稿为主。" },
  { q: "积分什么时候扣除？", a: "需要调用模型或生成报告的付费功能会在提交时展示所需积分；失败任务按对应规则退回。" },
  { q: "客户子账号能看到什么？", a: "客户只能访问被授权的客户面板和结果，不能创建其他客户；执行反馈是否可见由主账号控制。" },
  { q: "遇到任务长时间没有完成怎么办？", a: "先在任务中心查看状态，可重试的任务会自动恢复；仍未恢复时再取消任务并重新提交。" },
]

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "TechArticle",
      headline: "势途 GEO 网站说明与使用帮助",
      description: "势途 GEO 全链路操作工具的用户使用说明。",
      dateModified: UPDATED_AT,
      inLanguage: "zh-CN",
      mainEntityOfPage: `${SITE_URL}/help`,
      publisher: { "@type": "Organization", name: "杭州势途数字科技有限公司", url: SITE_URL },
    },
    {
      "@type": "FAQPage",
      mainEntity: faqs.map(item => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ],
}

const toc = [
  ["about", "网站说明"],
  ["quick-start", "快速开始"],
  ["modules", "七个功能模块"],
  ["accounts", "客户与团队"],
  ["tasks", "任务与数据"],
  ["billing", "积分与报告"],
  ["faq", "常见问题"],
]

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-[#F4F9FF] text-[#102A43]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <header className="border-b border-white/12 bg-[#001D66] text-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="返回势途 GEO 首页">
            <Image src="/brand/shitu-lockup-transparent-v2.png" alt="势途 GEO" width={180} height={54} className="h-9 w-auto rounded-md bg-white object-contain px-1.5" priority />
            <span className="hidden text-xs font-semibold text-white/70 sm:block">帮助中心</span>
          </Link>
          <Link href="/workspace" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-[#0958D9] transition hover:bg-cyan-50">进入工作台<ArrowRight className="h-4 w-4" /></Link>
        </div>
      </header>

      <section className="relative overflow-hidden bg-[linear-gradient(118deg,#001D66_0%,#0958D9_48%,#00AEEA_100%)] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(105,227,224,.34),transparent_28%)]" />
        <div className="relative mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-18">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/14 ring-1 ring-white/25"><CircleHelp className="h-5 w-5" /></div>
          <p className="mt-6 text-xs font-semibold text-cyan-100">势途 GEO 使用说明</p>
          <h1 className="mt-2 max-w-3xl text-3xl font-bold leading-tight sm:text-4xl">从创建客户到交付报告，找到每一步怎么做</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-blue-50/78">这里说明每个功能能解决什么问题、如何开始，以及结果应该去哪里查看。更新时间：{UPDATED_AT}</p>
        </div>
      </section>

      <main className="mx-auto grid max-w-7xl gap-10 px-4 py-10 md:px-8 lg:grid-cols-[210px_minmax(0,1fr)] lg:py-14">
        <aside className="hidden lg:block">
          <nav className="sticky top-6 border-l border-[#C9DDF4] pl-4" aria-label="帮助目录">
            <div className="mb-3 text-[11px] font-bold text-slate-400">目录</div>
            {toc.map(([id, label]) => <a key={id} href={`#${id}`} className="block border-l-2 border-transparent py-2 text-xs font-semibold text-slate-500 transition hover:border-[#1677FF] hover:text-[#0958D9]">{label}</a>)}
          </nav>
        </aside>

        <article className="min-w-0 space-y-14">
          <HelpSection id="about" icon={BookOpenCheck} title="网站说明">
            <p>势途 GEO 是面向品牌、企业、专业服务者和 GEO 运营团队的全链路操作工具。它把 AI 可见度检测、行业研究、网站诊断、难度评估、关键词策略、文章生产和持续反馈放在同一个客户工作区中。</p>
            <p>系统产出用于辅助判断和执行。涉及品牌事实、资质、案例、价格和承诺时，请以客户确认后的真实资料为准。</p>
          </HelpSection>

          <HelpSection id="quick-start" icon={ArrowRight} title="快速开始">
            <ol className="grid gap-px overflow-hidden rounded-lg border border-[#D6E7F8] bg-[#D6E7F8] sm:grid-cols-2">
              {["创建客户档案并选择品牌或个人 IP", "上传资料并补充名称、行业、网址和优势", "选择一个模块完成首次任务", "从消息中心、任务中心或历史报告查看结果"].map((item, index) => <li key={item} className="flex min-h-24 gap-3 bg-white p-4"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#1677FF] font-mono text-xs font-bold text-white">{index + 1}</span><span className="pt-1 text-sm leading-6 text-slate-700">{item}</span></li>)}
            </ol>
          </HelpSection>

          <HelpSection id="modules" icon={FileText} title="七个功能模块">
            <div className="divide-y divide-[#D9E8F7] border-y border-[#D9E8F7]">
              {modules.map((module, index) => <section key={module.id} id={module.id} className="scroll-mt-20 py-7"><div className="grid gap-5 lg:grid-cols-[180px_1fr]"><div><div className="text-[10px] font-bold text-[#00AEEA]">{String(index + 1).padStart(2, "0")}</div><h3 className="mt-1 text-lg font-bold text-[#0B2F5B]">{module.title}</h3><p className="mt-2 text-xs leading-6 text-slate-500">{module.purpose}</p></div><div><ol className="grid gap-2 sm:grid-cols-2">{module.steps.map((step, stepIndex) => <li key={step} className="flex gap-2 text-sm leading-6 text-slate-700"><span className="font-mono text-[10px] font-bold text-[#1677FF]">{stepIndex + 1}.</span>{step}</li>)}</ol><div className="mt-4 border-l-2 border-[#00AEEA] bg-[#EDF8FF] px-4 py-3 text-xs leading-6 text-[#38536E]"><strong className="text-[#0958D9]">可获得：</strong>{module.output}</div></div></div></section>)}
            </div>
          </HelpSection>

          <HelpSection id="accounts" icon={UsersRound} title="客户与团队">
            <TextRows items={[
              ["我的客户", "保存独立的品牌、个人 IP、疑问句、策略与历史结果。切换前先确认当前客户名称。"],
              ["客户子账号", "只能进入被授权的客户面板。主账号可以控制可查看的执行动作和报告内容。"],
              ["团队协作", "达到对应 VIP 等级后可创建团队，按模块分配查看、编辑、执行或管理权限。"],
              ["客户资料库", "优先保存已经核验的品牌事实、优势、案例和来源，文章与策略可以持续复用。"],
            ]} />
          </HelpSection>

          <HelpSection id="tasks" icon={Clock3} title="任务与数据">
            <TextRows items={[
              ["后台任务", "任务提交成功后可以切换模块、客户或账号；任务会继续执行，完成后进入消息中心和任务中心。"],
              ["输入草稿", "同一设备会按客户保留尚未提交的输入。切换客户时不会把 A 客户的内容带到 B 客户。"],
              ["云端结果", "历史检测、生成结果、专业报告与正式执行记录保存在云端，同一账号换设备后仍可查看。"],
              ["取消任务", "处理中的任务可在任务中心取消。已经产生的有效结果仍会按任务状态保留。"],
            ]} />
          </HelpSection>

          <HelpSection id="billing" icon={WalletCards} title="积分与报告">
            <TextRows items={[
              ["积分", "提交付费功能前会显示所需积分。充值到账、功能扣费和退款可以在我的主页查看。"],
              ["VIP", "等级按累计实际到账金额解锁，对应客户账号、团队和白标报告等权益。"],
              ["专业报告", "支持按模块导出。满足白标权益后，可以使用自己的公司名称和 Logo。"],
              ["发票", "在充值记录中点击申请发票，通过客服提交开票资料。"],
            ]} />
          </HelpSection>

          <HelpSection id="faq" icon={MessageSquareText} title="常见问题">
            <div className="divide-y divide-[#D9E8F7] border-y border-[#D9E8F7]">{faqs.map(item => <details key={item.q} className="group py-4"><summary className="cursor-pointer list-none pr-8 text-sm font-semibold text-[#163B66] marker:hidden">{item.q}<span className="float-right text-[#1677FF] transition group-open:rotate-45">+</span></summary><p className="mt-3 pr-8 text-sm leading-7 text-slate-600">{item.a}</p></details>)}</div>
          </HelpSection>

          <section className="flex flex-col gap-4 border-t border-[#C9DDF4] py-8 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="text-lg font-bold text-[#0B2F5B]">先体验，再正式开始</h2><p className="mt-1 text-xs leading-6 text-slate-500">新手教程不会等待真实模型，可以快速走完一次完整流程。</p></div>
            <div className="flex gap-2"><Link href="/workspace/tutorial?manual=1" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#91CAFF] bg-white px-4 text-xs font-semibold text-[#0958D9]">体验教程</Link><Link href="/workspace" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white">进入工作台<ArrowRight className="h-4 w-4" /></Link></div>
          </section>
        </article>
      </main>
      <SiteFooter />
    </div>
  )
}

function HelpSection({ id, icon: Icon, title, children }: { id: string; icon: typeof CircleHelp; title: string; children: React.ReactNode }) {
  return <section id={id} className="scroll-mt-20"><div className="mb-5 flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00AEEA] text-white shadow-sm"><Icon className="h-4 w-4" /></span><h2 className="text-xl font-bold text-[#0B2F5B]">{title}</h2></div><div className="space-y-3 text-sm leading-7 text-slate-600">{children}</div></section>
}

function TextRows({ items }: { items: Array<[string, string]> }) {
  return <div className="divide-y divide-[#D9E8F7] border-y border-[#D9E8F7]">{items.map(([title, body]) => <div key={title} className="grid gap-1 py-4 sm:grid-cols-[150px_1fr]"><h3 className="text-sm font-bold text-[#163B66]">{title}</h3><p className="text-sm leading-7 text-slate-600">{body}</p></div>)}</div>
}
