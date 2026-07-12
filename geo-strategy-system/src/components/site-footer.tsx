import Link from "next/link"

type SiteFooterProps = {
  className?: string
}

const ICP_RECORD = "浙ICP备2026049643号-1"

export default function SiteFooter({ className = "" }: SiteFooterProps) {
  return (
    <footer className={`no-print border-t border-slate-200/70 bg-white/55 backdrop-blur ${className}`}>
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-center text-[11px] leading-relaxed text-slate-500 md:px-8">
        <div className="font-medium text-slate-600">
          © 2026 杭州势途数字科技有限公司 版权所有
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span>势途 GEO 生成式引擎优化提效终端</span>
          <span className="hidden text-slate-300 sm:inline">|</span>
          <span>域名：shitugeo.top</span>
          <span className="hidden text-slate-300 sm:inline">|</span>
          <Link href="/terms" className="font-medium text-slate-600 transition hover:text-[#003EB3]">
            服务协议
          </Link>
          <span className="hidden text-slate-300 sm:inline">|</span>
          <Link href="/privacy" className="font-medium text-slate-600 transition hover:text-[#003EB3]">
            隐私政策
          </Link>
          <span className="hidden text-slate-300 sm:inline">|</span>
          <Link href="/recharge-rules" className="font-medium text-slate-600 transition hover:text-[#003EB3]">
            充值规则
          </Link>
          <span className="hidden text-slate-300 sm:inline">|</span>
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-slate-600 transition hover:text-[#003EB3]"
          >
            {ICP_RECORD}
          </a>
        </div>
      </div>
    </footer>
  )
}
