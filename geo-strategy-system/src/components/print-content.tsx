"use client"

import { forwardRef } from "react"
import type { GeoStrategy } from "@/types"

interface PrintContentProps {
  strategy: GeoStrategy
}

export const PrintContent = forwardRef<HTMLDivElement, PrintContentProps>(
  function PrintContent({ strategy }, ref) {
    return (
      <div ref={ref} className="p-8 bg-white" style={{ fontFamily: "Arial, sans-serif" }}>
        {/* Header */}
        <div className="border-b-2 border-[#004B73] pb-4 mb-6">
          <h1 className="text-2xl font-bold text-[#004B73]">势途 GEO 策略方案</h1>
          <p className="text-sm text-slate-400 mt-1">
            生成时间: {new Date().toLocaleDateString("zh-CN")}
          </p>
        </div>

        {/* Domain Strategy */}
        {strategy.domainStrategy?.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-3">域名策略矩阵</h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-3 py-2 text-left">推荐域名</th>
                  <th className="border border-slate-300 px-3 py-2 text-left">适配说明</th>
                  <th className="border border-slate-300 px-3 py-2 text-left">内容策略</th>
                </tr>
              </thead>
              <tbody>
                {strategy.domainStrategy.map((item, i) => (
                  <tr key={i}>
                    <td className="border border-slate-300 px-3 py-2 font-mono text-[#004B73]">{item.domain}</td>
                    <td className="border border-slate-300 px-3 py-2">{item.purpose}</td>
                    <td className="border border-slate-300 px-3 py-2">{item.contentStrategy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Key Data Points */}
        {strategy.keyDataPoints?.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-3">核心数据锚点</h2>
            <div className="grid grid-cols-2 gap-3">
              {strategy.keyDataPoints.map((item, i) => (
                <div key={i} className="border border-slate-300 rounded p-3">
                  <div className="text-xl font-bold text-emerald-700">{item.value}</div>
                  <div className="text-sm font-medium mt-1">{item.metric}</div>
                  <div className="text-xs text-slate-500 mt-1">{item.packaging}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Content Angles */}
        {strategy.contentAngles?.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-3">高频内容切入点</h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-3 py-2 text-left">内容切入点</th>
                  <th className="border border-slate-300 px-3 py-2 text-left">搜索意图</th>
                  <th className="border border-slate-300 px-3 py-2 text-left">内容形式</th>
                  <th className="border border-slate-300 px-3 py-2 text-left">难度</th>
                </tr>
              </thead>
              <tbody>
                {strategy.contentAngles.map((item, i) => (
                  <tr key={i}>
                    <td className="border border-slate-300 px-3 py-2 font-medium">{item.angle}</td>
                    <td className="border border-slate-300 px-3 py-2">{item.intent}</td>
                    <td className="border border-slate-300 px-3 py-2">{item.format}</td>
                    <td className="border border-slate-300 px-3 py-2">{item.difficulty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Domestic Media Distribution */}
        {strategy.domesticMediaDistribution?.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-3">国内大模型分发策略</h2>
            {strategy.domesticMediaDistribution.map((item, i) => (
              <div key={i} className="border border-slate-300 rounded p-3 mb-3">
                <h3 className="font-bold text-[#004B73] mb-2">{item.ecosystem}</h3>
                <p className="text-sm mb-1"><span className="font-medium">推荐平台：</span>{item.platforms}</p>
                <p className="text-sm mb-1"><span className="font-medium">内容运营建议：</span>{item.contentAdvice}</p>
                <p className="text-sm"><span className="font-medium">身份伪装建议：</span>{item.personaAdvice}</p>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-slate-400 mt-8 pt-4 border-t border-slate-200">
          由势途 GEO 提效终端生成 · {new Date().toLocaleDateString("zh-CN")}
        </div>
      </div>
    )
  }
)
