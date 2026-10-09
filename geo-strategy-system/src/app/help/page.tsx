import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowRight,
  Bot,
  BookOpenCheck,
  CircleHelp,
  Clock3,
  Database,
  FileText,
  ListChecks,
  MessageSquareText,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
  WalletCards,
} from "lucide-react"
import SiteFooter from "@/components/site-footer"

const SITE_URL = "https://shitugeo.top"
const UPDATED_AT = "2026-08-18"

export const metadata: Metadata = {
  title: "帮助与使用说明 · 势途 GEO",
  description: "势途 GEO 从客户建档、联网检测、策略与内容生产，到执行反馈、报告交付和 Agent 接入的完整使用说明。",
  alternates: { canonical: `${SITE_URL}/help` },
}

const modules = [
  {
    workflow: "insight",
    id: "module-penetration",
    title: "渗透率情报",
    purpose: "用多个 AI 模型独立联网回答同一批真实问题，查看品牌或个人 IP 的提及、竞品、信源和可见度。",
    prepare: "客户名称、品牌别名或人物姓名、行业、竞品线索，以及用户真实会搜索的疑问句。",
    steps: ["选择客户并补充品牌或个人 IP 信息", "输入疑问句并选择检测模型", "提交后可离开页面，任务会在后台继续", "完成后从消息中心或历史报告查看结果"],
    output: "原始联网回答、引用网址、品牌声量、关键词热度、模型对比和专业报告。",
    done: "每个有效样本都有独立原始回答；可联网模型有可点击信源；品牌别名已经合并；失败样本有明确原因。",
    next: "把高频信源和薄弱问题带入关键词策略，后续按相同问题定期复测。",
  },
  {
    workflow: "insight",
    id: "module-research",
    title: "独立调研",
    purpose: "强制读取可访问的公开网页，围绕客户、行业与竞争环境形成可追溯研究。",
    prepare: "明确调研对象、行业、区域、业务范围、已知竞品和希望回答的关键问题。",
    steps: ["确认调研对象、区域和行业范围", "系统检索并打开多个独立来源", "根据已验证证据生成调研与竞品对比", "逐条查看引用编号和原始网址"],
    output: "行业现状、竞争关系、机会判断、风险提示、证据引用和可点击的原始信源。",
    done: "重要结论均能对应公开证据，链接可以打开，调研范围和时间边界写清楚。",
    next: "用调研结论补充竞争对象、平台选择和难度测评参数。",
  },
  {
    workflow: "assessment",
    id: "module-diagnosis",
    title: "AI 诊断",
    purpose: "检查网站和品牌资料是否容易被 AI 发现、理解、引用和验证。",
    prepare: "一个公网可以打开的网站地址；若有改版计划，同时准备目标页面和业务重点。",
    steps: ["填写可访问的网站地址", "启动真实网站诊断", "查看标题结构、问答、robots、llms.txt 与可信度表现", "按优先级完成改进"],
    output: "诊断分数、问题证据、影响说明和可执行修复建议。",
    done: "H1/H2、Q&A、结构化信息、robots.txt、llms.txt、E-E-A-T 与页面证据都有明确判断。",
    next: "按高优先级修复网站，再重新诊断确认问题是否消失。",
  },
  {
    workflow: "assessment",
    id: "module-difficulty",
    title: "难度测评",
    purpose: "评估进入目标行业和区域后，建立 AI 稳定提及所需的竞争难度、周期、内容量与预算。",
    prepare: "行业、目标区域、目标主体、网站、客单价、毛利、复购与行业合规敏感程度。",
    steps: ["填写行业、区域和业务资料", "确认竞争对象与高敏感属性", "生成七维难度评估", "查看分阶段成本和执行量"],
    output: "七维评分、难度等级、预计周期、阶段目标、内容数量和执行成本。",
    done: "四个难度档位、七维评分、三阶段目标、预计天数、各内容类型数量和成本都已形成。",
    next: "结合客户预算确认服务周期，再进入关键词与发布规划。",
  },
  {
    workflow: "strategy",
    id: "module-keyword",
    title: "关键词策略",
    purpose: "把客户资料转成可执行的关键词、用户疑问句、优势匹配和平台发布策略。",
    prepare: "客户基础资料、产品或服务、目标用户、真实优势、痛点场景、竞品和已有检测信源。",
    steps: ["上传或填写客户资料", "生成并确认关键词策略", "按意图生成疑问句并匹配优势", "导出 Word、表格或 PDF 策略报告"],
    output: "关键词体系、疑问句池、优势匹配、平台策略和内容执行建议。",
    done: "每条疑问句简洁自然、不植入优势；生成后另行匹配可佐证优势；策略可导出并进入文章生产。",
    next: "人工筛选要执行的问题，建立发布规划或直接自动成文。",
  },
  {
    workflow: "content",
    id: "module-article",
    title: "文章生成",
    purpose: "根据客户知识资料、疑问句、优势和文章方法生成或改写可交付内容。",
    prepare: "文章目标、目标平台、疑问句、匹配优势、推荐品牌、必要竞品和经过确认的客户资料。",
    steps: ["选择文章类型和模型", "填写品牌资料或导入疑问句与优势", "单篇、批量或自动成文", "人工复核后下载 Word 文档"],
    output: "Markdown 正文、质量检查结果以及可单独或批量下载的 Word 文档。",
    done: "文章结构符合所选方法，事实来自客户资料或可验证来源，失败文章也可人工查看并按范围下载。",
    next: "人工复核后下载，或按发布规划生成分平台内容包。",
  },
  {
    workflow: "feedback",
    id: "module-feedback",
    title: "执行反馈",
    purpose: "持续记录已经完成的发布、优化、检测和沟通动作，形成客户可核验的周报与月报。",
    prepare: "正式执行起止日期、负责人、阶段目标，以及每天完成动作的标题、网址和证据。",
    steps: ["设置正式执行日期", "每天录入动作或批量导入证据网址", "选择哪些动作对客户可见", "生成并发布周报或月报"],
    output: "动作日历、证据链接、阶段进度、前后效果对比和客户反馈报告。",
    done: "报告覆盖完整 7 天或完整月度区间，动作证据可打开，基线与当前检测由负责人确认。",
    next: "发布私密链接、发送客户邮箱，并按计划继续记录下一周期动作。",
  },
]

const workflows = [
  { id: "insight", title: "情报洞察", purpose: "先看清 AI 可见度、行业事实和竞争格局。" },
  { id: "assessment", title: "诊断评估", purpose: "判断网站基础、执行难度、周期与预算。" },
  { id: "strategy", title: "策略规划", purpose: "把资料和证据转成疑问句、优势和发布规划。" },
  { id: "content", title: "内容生产", purpose: "按任务、平台和方法论生成或改写内容。" },
  { id: "feedback", title: "执行复盘", purpose: "记录动作、对比效果并向客户持续反馈。" },
] as const

const rolePaths = [
  {
    title: "第一次使用",
    detail: "先完成新手体验，再创建一个测试客户。建议依次体验渗透率情报、关键词策略和文章生成。",
    href: "/workspace/tutorial?manual=1",
    action: "进入新手体验",
  },
  {
    title: "GEO 运营人员",
    detail: "从客户资料与基线检测开始，建立问题池、发布规划和内容任务，最后持续录入执行证据。",
    href: "/workspace",
    action: "进入工作台",
  },
  {
    title: "团队负责人",
    detail: "在我的主页管理客户、成员与权限，查看任务、历史成果、积分和客户交付进度。",
    href: "/account?tab=clients",
    action: "管理我的客户",
  },
  {
    title: "客户子账号",
    detail: "查看被授权客户的检测结果、执行日历、周报和月报；可见范围由主账号设置。",
    href: "/workspace",
    action: "查看客户面板",
  },
  {
    title: "Agent 自动执行",
    detail: "创建专属密钥后，让 Codex、Claude、Cursor、CLI 或自建 Agent 按授权客户执行工作流。",
    href: "/agent",
    action: "查看 Agent 接入",
  },
] as const

const taskStatuses = [
  ["排队中", "任务已经成功提交，正在等待可用模型或执行资源，不需要重复点击。"],
  ["处理中", "任务正在后台运行，可以切换模块、客户、设备或关闭当前页面。"],
  ["重试中", "某个临时环节失败，系统正在按原任务恢复，不会因为刷新页面重新扣费。"],
  ["部分完成", "已有可用结果，但少数问题或文章没有完成；可先查看结果，再决定是否补测。"],
  ["已完成", "结果已写入客户历史，可从消息中心、任务中心或历史成果打开。"],
  ["失败/已取消", "查看失败原因和已保留结果；需要重新执行时使用新的任务，不要反复刷新旧任务。"],
] as const

const faqs = [
  { q: "提交任务后可以切换客户或退出页面吗？", a: "可以。已提交的检测、生成和报告任务会在后台继续，完成后会进入任务中心或消息中心。" },
  { q: "为什么切换客户后看到的内容不同？", a: "每个客户拥有独立资料、输入草稿和结果。请先确认工作台左上角显示的是正确客户。" },
  { q: "哪些信息会在其他设备同步？", a: "系统生成的历史结果、报告、客户资料和正式执行记录会保存在云端。尚未提交的临时输入以当前设备草稿为主。" },
  { q: "积分什么时候扣除？", a: "需要调用模型或生成报告的付费功能会在提交时展示所需积分；失败任务按对应规则退回。" },
  { q: "客户子账号能看到什么？", a: "客户只能访问被授权的客户面板和结果，不能创建其他客户；执行反馈是否可见由主账号控制。" },
  { q: "遇到任务长时间没有完成怎么办？", a: "先在任务中心查看状态，可重试的任务会自动恢复；仍未恢复时再取消任务并重新提交。" },
  { q: "同一个问题再次检测会不会复用旧回答？", a: "不会。每次正式提交都会创建独立检测样本；历史结果只用于对比，不会替代新的模型联网回答。" },
  { q: "为什么有的模型没有结果？", a: "先查看该模型的联网审计与任务提示。账号池、模型服务商或信源访问临时异常时，系统会保留其他已完成模型的真实结果，不会编造补齐。" },
  { q: "资料库放得越多，文章就一定越好吗？", a: "不是。只保存真实、可核验且与客户长期相关的资料。生成时系统会按问题选择相关资料，仍建议在下载前人工核对数据、资质和案例。" },
  { q: "怎样让客户看到周报或检测报告？", a: "在执行反馈中设置动作可见范围，再发布周报或月报链接；也可以为客户创建专属账号，让客户从日历动作进入对应历史报告。" },
  { q: "Agent 能修改充值、密码或 API Key 吗？", a: "不能。充值与积分、密码邮箱、模型 API Key、团队成员和管理员财务操作必须由人在受保护页面完成。" },
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
    {
      "@type": "HowTo",
      name: "如何使用势途 GEO 完成一次 GEO 全链路工作",
      description: "从客户建档、真实联网检测、策略与内容生产，到执行反馈和客户交付。",
      totalTime: "P1D",
      step: [
        "创建客户并确认品牌或个人 IP",
        "补充客户资料和可核验证据",
        "完成渗透率情报基线检测",
        "完成调研、诊断与难度评估",
        "生成关键词、疑问句和发布规划",
        "生成内容并记录执行证据",
        "发布周报或月报并持续复测",
      ].map((name, index) => ({ "@type": "HowToStep", position: index + 1, name })),
    },
  ],
}

const toc = [
  ["about", "网站说明"],
  ["roles", "按身份开始"],
  ["quick-start", "快速开始"],
  ["modules", "五段业务工作流"],
  ["knowledge", "客户资料库"],
  ["accounts", "客户与团队"],
  ["tasks", "任务与数据"],
  ["billing", "积分与报告"],
  ["agent-access", "Agent 接入"],
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
            <p>势途 GEO 是面向品牌、企业、专业服务者和 GEO 运营团队的全链路操作工具。它将能力收敛为情报洞察、诊断评估、策略规划、内容生产和执行复盘五段业务工作流。</p>
            <p>系统产出用于辅助判断和执行。涉及品牌事实、资质、案例、价格和承诺时，请以客户确认后的真实资料为准。</p>
          </HelpSection>

          <HelpSection id="roles" icon={UserRoundCog} title="按身份开始">
            <p>不用先学完全部功能。找到最接近自己的身份，从对应入口完成第一件事。</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {rolePaths.map(role => (
                <Link key={role.title} href={role.href} className="group rounded-lg border border-[#D6E7F8] bg-white p-4 transition hover:border-[#69B1FF] hover:shadow-sm">
                  <h3 className="text-sm font-bold text-[#163B66]">{role.title}</h3>
                  <p className="mt-2 text-xs leading-6 text-slate-500">{role.detail}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#1677FF]">{role.action}<ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
                </Link>
              ))}
            </div>
          </HelpSection>

          <HelpSection id="quick-start" icon={ArrowRight} title="快速开始">
            <ol className="grid gap-px overflow-hidden rounded-lg border border-[#D6E7F8] bg-[#D6E7F8] sm:grid-cols-2">
              {["进入我的主页，创建客户并选择品牌或个人 IP", "补充名称、别名、行业、网址、优势和可核验资料", "先做渗透率情报，保存一份真实的基线结果", "做独立调研、AI 诊断和难度测评，确认机会与投入", "生成关键词、疑问句、优势匹配和发布规划", "生产内容、记录执行证据，并用周报/月报持续复盘"].map((item, index) => <li key={item} className="flex min-h-24 gap-3 bg-white p-4"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#1677FF] font-mono text-xs font-bold text-white">{index + 1}</span><span className="pt-1 text-sm leading-6 text-slate-700">{item}</span></li>)}
            </ol>
            <div className="mt-4 border-l-2 border-[#13C2C2] bg-[#EDFFFC] px-4 py-3 text-xs leading-6 text-[#38536E]">建议先用少量真实问题走完整流程，确认客户资料和结果结构后再扩大任务量。大量任务提交后可离开页面，不需要停留等待。</div>
          </HelpSection>

          <HelpSection id="modules" icon={FileText} title="五段业务工作流">
            <div className="space-y-8">
              {workflows.map((workflow, workflowIndex) => (
                <section key={workflow.id} className="border-t border-[#D9E8F7] pt-6">
                  <div className="mb-2 flex items-baseline gap-3">
                    <span className="font-mono text-[10px] font-bold text-[#00AEEA]">{String(workflowIndex + 1).padStart(2, "0")}</span>
                    <h3 className="text-lg font-bold text-[#0B2F5B]">{workflow.title}</h3>
                  </div>
                  <p className="mb-3 text-xs leading-6 text-slate-500">{workflow.purpose}</p>
                  <div className="divide-y divide-[#D9E8F7] border-y border-[#D9E8F7]">
                    {modules.filter(module => module.workflow === workflow.id).map(module => (
                      <section key={module.id} id={module.id} className="scroll-mt-20 py-6">
                        <div className="grid gap-5 lg:grid-cols-[180px_1fr]">
                          <div><h4 className="text-base font-bold text-[#163B66]">{module.title}</h4><p className="mt-2 text-xs leading-6 text-slate-500">{module.purpose}</p></div>
                          <div>
                            <div className="mb-4 rounded-md bg-[#F7FAFD] px-4 py-3 text-xs leading-6 text-slate-600"><strong className="text-[#163B66]">开始前准备：</strong>{module.prepare}</div>
                            <ol className="grid gap-2 sm:grid-cols-2">{module.steps.map((step, stepIndex) => <li key={step} className="flex gap-2 text-sm leading-6 text-slate-700"><span className="font-mono text-[10px] font-bold text-[#1677FF]">{stepIndex + 1}.</span>{step}</li>)}</ol>
                            <div className="mt-4 border-l-2 border-[#00AEEA] bg-[#EDF8FF] px-4 py-3 text-xs leading-6 text-[#38536E]"><strong className="text-[#0958D9]">可获得：</strong>{module.output}</div>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <p className="rounded-md border border-[#DCEAF7] bg-white px-3 py-2.5 text-xs leading-6 text-slate-600"><strong className="text-[#163B66]">完成标准：</strong>{module.done}</p>
                              <p className="rounded-md border border-[#CBEFE9] bg-[#F4FFFD] px-3 py-2.5 text-xs leading-6 text-slate-600"><strong className="text-[#087F7A]">下一步：</strong>{module.next}</p>
                            </div>
                          </div>
                        </div>
                      </section>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </HelpSection>

          <HelpSection id="knowledge" icon={Database} title="客户资料库">
            <p>资料库是客户长期事实的统一来源，不是把所有文件原样塞给模型。系统会先解析文件，生成待确认的候选资料；只有人工确认后的内容才进入正式资料库。</p>
            <TextRows items={[
              ["建议上传", "品牌介绍、产品与服务、真实优势、参数、资质、案例、目标用户、常见问题、官网资料和可验证来源。支持文档与表格批量解析。"],
              ["不建议上传", "与客户无关的大段行业资料、已经过期的价格、未经确认的网络传言，以及互相矛盾的多个版本。"],
              ["审核原则", "逐条确认事实、证据等级、发生时间和来源网址。没有依据的数据、排名、案例与承诺不要写入正式资料。"],
              ["如何用于生成", "文章和策略只按当前疑问句选择相关资料，不会把整个资料库一次性塞进 Prompt。仍可在单次任务中补充更具体的要求。"],
              ["更新方式", "资料变化时新增正确版本，并在标题或发生时间中说明。重要事实应保留原始文件或公开网址作为证据。"],
            ]} />
          </HelpSection>

          <HelpSection id="accounts" icon={UsersRound} title="客户与团队">
            <TextRows items={[
              ["我的客户", "每个客户独立保存品牌或个人 IP、资料、问题、策略和历史结果。新增后会立即出现在列表；切换前确认顶部客户名称。"],
              ["品牌与个人 IP", "创建时选择主体类型。个人 IP 会按姓名、职业、机构、专长和地区识别同行，不会套用普通品牌竞品逻辑。"],
              ["客户子账号", "只能进入被授权客户，不能新建其他客户。主账号可以逐项控制检测权限、动作摘要和完整报告是否可见。"],
              ["团队协作", "达到对应 VIP 等级后可创建团队，并按客户和模块授予查看、执行、编辑、导出或管理权限。"],
              ["删除与停用", "删除客户子账号会先进入停用状态，可由管理员恢复；删除客户档案前应确认历史报告和共享关系。"],
            ]} />
          </HelpSection>

          <HelpSection id="tasks" icon={Clock3} title="任务与数据">
            <TextRows items={[
              ["后台任务", "任务提交成功后可以切换模块、客户或账号；任务会继续执行，完成后进入消息中心和任务中心。"],
              ["输入草稿", "同一设备会按客户保留尚未提交的输入。切换客户时不会把 A 客户的内容带到 B 客户。"],
              ["云端结果", "历史检测、生成结果、专业报告与正式执行记录保存在云端，同一账号换设备后仍可查看。"],
              ["取消任务", "处理中的任务可在任务中心取消。已经产生的有效结果仍会按任务状态保留。"],
            ]} />
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-bold text-[#163B66]">任务状态怎么理解</h3>
              <TextRows items={taskStatuses.map(item => [item[0], item[1]])} />
            </div>
            <div className="mt-4 rounded-lg border border-[#CBEFE9] bg-[#F4FFFD] p-4 text-xs leading-6 text-[#38536E]"><strong className="text-[#087F7A]">数据原则：</strong>尚未提交的输入按客户保留为草稿；系统产生的检测、策略、文章、报告和正式动作进入云端历史。多设备不会用整张工作区互相覆盖正式结果。</div>
          </HelpSection>

          <HelpSection id="billing" icon={WalletCards} title="积分与报告">
            <TextRows items={[
              ["积分", "提交付费功能前会显示所需积分。充值到账、功能扣费和退款可以在我的主页查看。"],
              ["VIP", "等级按累计实际到账金额解锁，对应客户账号、团队和白标报告等权益。"],
              ["专业报告", "支持按模块导出。满足白标权益后，可以使用自己的公司名称和 Logo。"],
              ["发票", "在充值记录中点击申请发票，通过客服提交开票资料。"],
            ]} />
          </HelpSection>

          <HelpSection id="agent-access" icon={Bot} title="Agent 接入">
            <div className="rounded-lg bg-[linear-gradient(120deg,#001D66,#0958D9_58%,#00AEEA)] p-5 text-white sm:p-6">
              <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
                <div><h3 className="text-lg font-bold">让 Agent 按授权客户直接执行 GEO 工作流</h3><p className="mt-2 text-xs leading-6 text-blue-50/80">支持 Codex、Claude、Cursor、通用 MCP、CLI 和 OpenAPI。任务沿用网页端权限、积分、联网规则、质量检查和云端历史。</p></div>
                <Link href="/agent" className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-white px-4 text-xs font-bold text-[#0958D9]">查看接入说明<ArrowRight className="h-4 w-4" /></Link>
              </div>
            </div>
            <ol className="mt-5 grid gap-3 sm:grid-cols-2">
              {["在 Agent 接入中心选择 Codex、Claude、Cursor、CLI 或通用 MCP", "创建专属密钥，只开放需要访问的客户和业务权限", "设置每日积分、单任务积分、访问频率、有效期和可选 IP 白名单", "先测试连接，再让 Agent 读取客户、试算任务、提交后台任务并回收真实结果"].map((item, index) => <li key={item} className="flex gap-3 rounded-lg border border-[#D6E7F8] bg-white p-4 text-sm leading-6 text-slate-700"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#1677FF] font-mono text-xs font-bold text-white">{index + 1}</span>{item}</li>)}
            </ol>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[#CBEFE9] bg-[#F4FFFD] p-4"><h3 className="flex items-center gap-2 text-sm font-bold text-[#087F7A]"><ListChecks className="h-4 w-4" />可以交给 Agent</h3><p className="mt-2 text-xs leading-6 text-slate-600">联网检测与自动监测、调研、诊断、难度、关键词和问题池、文章与配图、发布规划、执行记录、周月报、资料审核、历史结果与专业报告。</p></div>
              <div className="rounded-lg border border-[#FFE0B2] bg-[#FFF9ED] p-4"><h3 className="flex items-center gap-2 text-sm font-bold text-[#9A6700]"><ShieldCheck className="h-4 w-4" />必须由人操作</h3><p className="mt-2 text-xs leading-6 text-slate-600">充值与积分、发票、邮箱密码、模型 API Key、团队成员、客户账号授权、管理员审核和财务处理，不向 Agent Token 开放。</p></div>
            </div>
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
