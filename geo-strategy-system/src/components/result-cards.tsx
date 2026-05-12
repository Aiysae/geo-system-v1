"use client"

import { Globe, ExternalLink, TrendingUp, Lightbulb, Radio } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { DomainStrategy, KeyDataPoint, ContentAngle, MediaDistribution } from "@/types"

const DNSPOD_LINK = "https://dnspod.cloud.tencent.com/"

export function DomainStrategyCard({ items }: { items: DomainStrategy[] }) {
  if (!items?.length) return null

  return (
    <Card className="border-0 shadow-xl shadow-slate-200/50 bg-white/90 backdrop-blur">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2.5 text-lg">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#004B73]/10 to-blue-100/50 flex items-center justify-center">
            <Globe className="h-4 w-4 text-[#004B73]" />
          </div>
          域名策略矩阵
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {items.map((item, i) => (
            <div
              key={i}
              className="border border-slate-100 rounded-xl p-5 hover:bg-slate-50/50 hover:border-slate-200 transition-all duration-200"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-sm font-semibold text-[#004B73] tracking-tight">
                    {item.domain}
                  </span>
                  <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                    <span className="font-medium text-slate-800">适配说明：</span>
                    {item.purpose}
                  </p>
                  <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                    <span className="font-medium text-slate-800">内容策略：</span>
                    {item.contentStrategy}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 pt-4 border-t border-slate-100 text-center">
          <a
            href={DNSPOD_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-[#004B73] hover:text-[#006699] font-medium transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            前往腾讯云查询域名是否可注册
          </a>
        </div>
      </CardContent>
    </Card>
  )
}

export function KeyDataPointsCard({ items }: { items: KeyDataPoint[] }) {
  if (!items?.length) return null

  return (
    <Card className="border-0 shadow-xl shadow-slate-200/50 bg-white/90 backdrop-blur">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2.5 text-lg">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-100 to-emerald-50 flex items-center justify-center">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </div>
          核心数据锚点策略
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((item, i) => (
            <div
              key={i}
              className="border border-slate-100 rounded-xl p-5 bg-gradient-to-br from-white to-emerald-50/30 hover:shadow-md transition-all duration-200"
            >
              <div className="text-2xl font-bold text-emerald-700 tracking-tight">{item.value}</div>
              <div className="text-sm font-semibold text-slate-800 mt-1.5">{item.metric}</div>
              <div className="text-xs text-slate-500 mt-2 leading-relaxed">
                <span className="font-medium text-slate-700">Snippet 包装建议：</span>
                {item.packaging}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function ContentAngleCard({ angles }: { angles: ContentAngle[] }) {
  if (!angles?.length) return null

  const difficultyColor = (d: string) => {
    const lower = d.toLowerCase()
    if (lower.includes("简单") || lower.includes("低")) return "bg-emerald-50 text-emerald-700 border-emerald-200"
    if (lower.includes("中等") || lower.includes("中")) return "bg-amber-50 text-amber-700 border-amber-200"
    return "bg-red-50 text-red-700 border-red-200"
  }

  return (
    <Card className="border-0 shadow-xl shadow-slate-200/50 bg-white/90 backdrop-blur">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2.5 text-lg">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-100 to-amber-50 flex items-center justify-center">
            <Lightbulb className="h-4 w-4 text-amber-600" />
          </div>
          高频内容切入点
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {angles.map((item, i) => (
            <div
              key={i}
              className="border border-slate-100 rounded-xl p-5 hover:bg-slate-50/50 hover:border-slate-200 transition-all duration-200"
            >
              <div className="flex items-center gap-2.5 mb-2.5">
                <span className="font-semibold text-sm text-slate-800">{item.angle}</span>
                <Badge variant="secondary" className="text-xs bg-slate-100 text-slate-600">
                  {item.format}
                </Badge>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                <span className="font-medium text-slate-800">搜索意图：</span>
                {item.intent}
              </p>
              <div className="mt-3">
                <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium border ${difficultyColor(item.difficulty)}`}>
                  难度: {item.difficulty}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function MediaDistributionCard({ items }: { items: MediaDistribution[] }) {
  if (!items?.length) return null

  const ecoStyle = (eco: string) => {
    if (eco.includes("字节") || eco.includes("豆包"))
      return { border: "border-l-blue-500", bg: "bg-blue-50/60", badge: "bg-blue-100 text-blue-700" }
    if (eco.includes("阿里") || eco.includes("通义") || eco.includes("Kimi") || eco.includes("DeepSeek"))
      return { border: "border-l-purple-500", bg: "bg-purple-50/60", badge: "bg-purple-100 text-purple-700" }
    if (eco.includes("百度") || eco.includes("文心"))
      return { border: "border-l-red-500", bg: "bg-red-50/60", badge: "bg-red-100 text-red-700" }
    return { border: "border-l-slate-300", bg: "bg-slate-50", badge: "bg-slate-100 text-slate-700" }
  }

  return (
    <Card className="border-0 shadow-xl shadow-slate-200/50 bg-white/90 backdrop-blur">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2.5 text-lg">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#004B73]/10 to-blue-100/50 flex items-center justify-center">
            <Radio className="h-4 w-4 text-[#004B73]" />
          </div>
          国内大模型派系分发策略
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {items.map((item, i) => {
            const style = ecoStyle(item.ecosystem)
            return (
              <div
                key={i}
                className={`border-l-[3px] rounded-xl p-5 ${style.border} ${style.bg} transition-all duration-200`}
              >
                <div className="flex items-center gap-2.5 mb-3">
                  <h3 className="font-bold text-base text-slate-800">{item.ecosystem}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.badge}`}>
                    投放阵地
                  </span>
                </div>
                <div className="space-y-2.5 text-sm">
                  <p className="leading-relaxed">
                    <span className="font-medium text-slate-800">推荐平台：</span>
                    <span className="text-slate-600">{item.platforms}</span>
                  </p>
                  <p className="leading-relaxed">
                    <span className="font-medium text-slate-800">内容运营建议：</span>
                    <span className="text-slate-600">{item.contentAdvice}</span>
                  </p>
                  <p className="leading-relaxed">
                    <span className="font-medium text-slate-800">身份伪装建议：</span>
                    <span className="text-slate-600">{item.personaAdvice}</span>
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
