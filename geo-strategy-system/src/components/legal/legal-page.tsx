import Link from "next/link"
import SiteFooter from "@/components/site-footer"

export type LegalSection = {
  title: string
  items: string[]
}

export function LegalPage({
  title,
  summary,
  updatedAt,
  sections,
}: {
  title: string
  summary: string
  updatedAt: string
  sections: LegalSection[]
}) {
  return (
    <div className="min-h-screen geo-saturated-bg">
      <header className="border-b border-cyan-300/15 bg-[#061826]/94 text-white backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <Link href="/" className="text-sm font-bold text-cyan-100">
            势途 GEO
          </Link>
          <div className="flex items-center gap-2 text-xs text-white/62">
            <Link href="/terms" className="transition hover:text-cyan-100">服务协议</Link>
            <span className="text-white/25">|</span>
            <Link href="/privacy" className="transition hover:text-cyan-100">隐私政策</Link>
            <span className="text-white/25">|</span>
            <Link href="/recharge-rules" className="transition hover:text-cyan-100">充值规则</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-7 md:px-8 md:py-9">
        <article className="rounded-lg bg-white/94 p-6 shadow-xl shadow-slate-900/10 ring-1 ring-white/70 md:p-8">
          <div className="border-b border-slate-100 pb-5">
            <div className="geo-section-kicker">
              Legal
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">
              {title}
            </h1>
            <p className="mt-3 text-sm leading-7 text-slate-600">{summary}</p>
            <p className="mt-3 text-xs text-slate-400">最近更新：{updatedAt}</p>
          </div>

          <div className="mt-6 space-y-6">
            {sections.map(section => (
              <section key={section.title}>
                <h2 className="text-base font-semibold text-slate-900">{section.title}</h2>
                <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-600">
                  {section.items.map(item => (
                    <li key={item} className="rounded-lg bg-gradient-to-r from-sky-50 to-violet-50 px-4 py-3 ring-1 ring-slate-100">
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="mt-8 rounded-lg bg-gradient-to-r from-cyan-50 via-violet-50 to-rose-50 px-4 py-3 text-xs leading-6 text-slate-600 ring-1 ring-slate-100">
            如对协议、隐私或充值规则有疑问，请通过注册邮箱、付款备注或已对接的商务联系方式与杭州势途数字科技有限公司联系。
          </div>
        </article>
      </main>

      <SiteFooter />
    </div>
  )
}
