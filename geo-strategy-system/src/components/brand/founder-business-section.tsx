import Image from "next/image"

const FOUNDER_CREDENTIALS = [
  {
    label: "AI Business FDE",
    value: "课程创研人、奠基人",
  },
  {
    label: "可信事件模型",
    value: "AI 现实世界可信事件模型发起人、研发者",
  },
  {
    label: "GEO 价值体系",
    value: "首倡者",
  },
]

const BUSINESS_PATHS = [
  {
    title: "看清真实位置",
    description: "用多模型联网盲测还原品牌或个人 IP 的提及、竞品、排名与引用信源。",
  },
  {
    title: "形成增长策略",
    description: "把独立调研、AI 诊断、难度测评和关键词策略组成可执行的 GEO 路径。",
  },
  {
    title: "推动持续交付",
    description: "串联内容生成、平台发布规划、执行反馈与自动化监测，让结果可验证、可迭代。",
  },
]

export default function FounderBusinessSection() {
  return (
    <section
      id="about-shitu-ai"
      className="brand-about-section border-t border-[#B7D7FF]"
      aria-labelledby="about-shitu-ai-title"
    >
      <div className="bg-[#F7FBFF]">
        <div className="mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-20">
          <div className="max-w-4xl">
            <div className="text-[11px] font-semibold uppercase text-[#1677FF]">About Shitu AI</div>
            <h2
              id="about-shitu-ai-title"
              className="mt-3 text-3xl font-semibold leading-tight text-[#102A43] sm:text-4xl md:text-5xl"
            >
              势途 AI 创始人与业务介绍
            </h2>
            <p className="mt-5 text-lg font-semibold leading-8 text-[#0637A6] sm:text-xl">
              让 AI 进入现实世界，让技术兑现商业价值。
            </p>
          </div>
        </div>
      </div>

      <div className="brand-founder-band text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 md:px-8 md:py-20 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <div className="text-[11px] font-semibold uppercase text-[#8BE9FF]">Founder</div>
            <h3 className="mt-3 text-3xl font-semibold leading-tight text-white sm:text-4xl">Vantage万极</h3>
            <p className="mt-2 text-sm font-semibold text-[#8BE9FF] sm:text-base">势途 AI 创始人</p>

            <p className="mt-6 text-sm leading-7 text-[#DDF7FF]/78 sm:text-base sm:leading-8">
              作为长期站在人工智能、商业创新与真实世界交汇处的实践者，Vantage万极聚焦如何让 AI 从“拥有能力”走向“创造商业价值”，并将模型能力转化为可执行、可验证、可迭代的商业解决方案。
            </p>

            <blockquote className="mt-7 border-l-2 border-[#00CFFF] pl-5 text-base font-semibold leading-8 text-white sm:text-lg">
              企业不仅要被 AI 看见，更要被正确理解、可信引用，并在关键决策场景中被优先推荐。
            </blockquote>

            <dl className="mt-8 border-y border-cyan-100/16">
              {FOUNDER_CREDENTIALS.map((credential) => (
                <div
                  key={credential.label}
                  className="grid gap-1 border-b border-cyan-100/12 py-4 last:border-b-0 sm:grid-cols-[148px_1fr] sm:gap-5"
                >
                  <dt className="text-xs font-semibold text-[#8BE9FF]">{credential.label}</dt>
                  <dd className="text-sm leading-6 text-[#DDF7FF]/72">{credential.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <figure className="lg:col-span-7">
            <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-cyan-100/20 bg-[#06184A] shadow-[0_34px_84px_-46px_rgba(0,207,255,0.72)]">
              <Image
                src="/brand/about/vantage-wanji-trusted-ai-classroom.webp"
                alt="Vantage万极讲授 AI 现实世界可信事件模型"
                fill
                sizes="(max-width: 1024px) 100vw, 58vw"
                className="object-cover"
              />
            </div>
            <figcaption className="mt-3 text-xs leading-5 text-[#C8DFFF]/52">
              Vantage万极讲授“AI 现实世界可信事件模型”
            </figcaption>
          </figure>
        </div>
      </div>

      <div className="bg-white">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 md:px-8 md:py-20 lg:grid-cols-12 lg:gap-14">
          <figure className="lg:col-span-7">
            <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-[#B7D7FF] bg-[#EAF3FF] shadow-[0_34px_80px_-52px_rgba(3,55,166,0.58)]">
              <Image
                src="/brand/about/vantage-wanji-business-fde-classroom.webp"
                alt="Vantage万极讲授 AI Business FDE 从技术部署走向商业价值交付"
                fill
                sizes="(max-width: 1024px) 100vw, 58vw"
                className="object-cover"
              />
            </div>
            <figcaption className="mt-3 text-xs leading-5 text-slate-500">
              AI Business FDE：从技术部署走向商业价值交付
            </figcaption>
          </figure>

          <div className="lg:col-span-5">
            <div className="text-[11px] font-semibold uppercase text-[#1677FF]">What we do</div>
            <h3 className="mt-3 text-3xl font-semibold leading-tight text-[#102A43] sm:text-4xl">势途 AI 业务介绍</h3>
            <p className="mt-5 text-sm leading-7 text-slate-600 sm:text-base sm:leading-8">
              势途 AI 围绕品牌与个人 IP 在生成式搜索中的可见、可信与推荐，提供从检测、诊断、策略到内容生产和执行反馈的 GEO 全链路工具与运营服务。
            </p>

            <ol className="mt-8 border-t border-[#B7D7FF]">
              {BUSINESS_PATHS.map((path, index) => (
                <li key={path.title} className="grid grid-cols-[42px_1fr] gap-4 border-b border-[#B7D7FF] py-5">
                  <span className="pt-0.5 text-sm font-semibold tabular-nums text-[#1677FF]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <span className="block text-base font-semibold text-[#102A43]">{path.title}</span>
                    <span className="mt-1.5 block text-sm leading-6 text-slate-600">{path.description}</span>
                  </span>
                </li>
              ))}
            </ol>

            <p className="mt-7 text-base font-semibold leading-7 text-[#0637A6]">
              从“被 AI 看见”，到“被 AI 正确理解、可信引用与优先推荐”。
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
