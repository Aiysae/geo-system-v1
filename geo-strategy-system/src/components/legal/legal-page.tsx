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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30">
      <header className="border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <Link href="/" className="text-sm font-bold text-[#004B73]">
            势途 GEO
          </Link>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Link href="/terms" className="transition hover:text-[#004B73]">服务协议</Link>
            <span className="text-slate-300">|</span>
            <Link href="/privacy" className="transition hover:text-[#004B73]">隐私政策</Link>
            <span className="text-slate-300">|</span>
            <Link href="/recharge-rules" className="transition hover:text-[#004B73]">充值规则</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-10">
        <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 md:p-8">
          <div className="border-b border-slate-100 pb-5">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
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
                    <li key={item} className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="mt-8 rounded-xl bg-blue-50 px-4 py-3 text-xs leading-6 text-slate-600 ring-1 ring-blue-100">
            如对协议、隐私或充值规则有疑问，请通过注册邮箱、付款备注或已对接的商务联系方式与杭州势途数字科技有限公司联系。
          </div>
        </article>
      </main>

      <SiteFooter />
    </div>
  )
}
