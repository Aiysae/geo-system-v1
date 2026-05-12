"use client"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2, Building2, Target, Users, Swords, Lightbulb, TrendingUp, Zap, Sparkles } from "lucide-react"
import type { BrandInput } from "@/types"

interface InputPanelProps {
  input: BrandInput
  onChange: (input: BrandInput) => void
  onGenerate: () => void
  isGenerating: boolean
}

const fields = [
  {
    key: "brandName" as const,
    label: "品牌名称",
    placeholder: "例如：星辰科技",
    required: true,
    icon: Building2,
    type: "input",
  },
  {
    key: "brandSlogan" as const,
    label: "品牌标语",
    placeholder: "例如：让 AI 触手可及",
    required: false,
    icon: Lightbulb,
    type: "input",
  },
  {
    key: "industry" as const,
    label: "所属行业",
    placeholder: "例如：企业级 AI SaaS",
    required: false,
    icon: TrendingUp,
    type: "input",
  },
  {
    key: "coreAdvantages" as const,
    label: "核心优势（用数据说话）",
    placeholder: "例如：服务 5,000+ 企业客户，客户留存率 95%，平均 ROI 提升 300%",
    required: false,
    icon: Zap,
    type: "textarea",
  },
  {
    key: "targetMetrics" as const,
    label: "优化目标 / 关键指标",
    placeholder: "例如：提升品牌在 AI 大模型搜索中的可见度，月均 AI 搜索流量增长 50%",
    required: false,
    icon: Target,
    type: "textarea",
  },
  {
    key: "targetAudience" as const,
    label: "目标受众",
    placeholder: "例如：CTO、技术决策者、开发者",
    required: false,
    icon: Users,
    type: "input",
  },
  {
    key: "competitors" as const,
    label: "主要竞争对手",
    placeholder: "例如：竞品A、竞品B",
    required: false,
    icon: Swords,
    type: "input",
  },
]

export default function InputPanel({ input, onChange, onGenerate, isGenerating }: InputPanelProps) {
  const handleChange = (field: keyof BrandInput, value: string) => {
    onChange({ ...input, [field]: value })
  }

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-xl shadow-slate-200/50 bg-white/90 backdrop-blur overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-[#004B73] to-blue-400" />
        <CardContent className="pt-6 space-y-5">
          {fields.map((field) => {
            const Icon = field.icon
            return (
              <div key={field.key} className="space-y-2">
                <Label
                  htmlFor={field.key}
                  className="flex items-center gap-1.5 text-sm font-medium text-slate-700"
                >
                  <Icon className="h-3.5 w-3.5 text-[#004B73]/60" />
                  {field.label}
                  {field.required && (
                    <span className="text-red-400">*</span>
                  )}
                </Label>
                {field.type === "textarea" ? (
                  <Textarea
                    id={field.key}
                    placeholder={field.placeholder}
                    className="min-h-[90px] resize-none border-slate-200 bg-slate-50/50 focus:bg-white focus:border-[#004B73]/40 focus:ring-[#004B73]/10 transition-colors"
                    value={input[field.key]}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                  />
                ) : (
                  <Input
                    id={field.key}
                    placeholder={field.placeholder}
                    className="border-slate-200 bg-slate-50/50 focus:bg-white focus:border-[#004B73]/40 focus:ring-[#004B73]/10 transition-colors"
                    value={input[field.key]}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                  />
                )}
              </div>
            )
          })}

          <Button
            className="w-full h-11 text-sm font-semibold tracking-wide bg-gradient-to-r from-[#004B73] to-[#006699] hover:from-[#003554] hover:to-[#004B73] shadow-lg shadow-[#004B73]/20 transition-all duration-300"
            onClick={onGenerate}
            disabled={isGenerating || !input.brandName.trim()}
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                AI 生成中...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                生成势途专属 GEO 方案
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
