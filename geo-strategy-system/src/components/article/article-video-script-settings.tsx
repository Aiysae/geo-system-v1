"use client"

import {
  Clock3,
  Database,
  Film,
  Hash,
  Languages,
  ShieldCheck,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  ARTICLE_VIDEO_PLATFORM_OPTIONS,
  normalizeArticleVideoScriptConfig,
} from "@/lib/article-video-script"
import type { ArticleVideoScriptConfig } from "@/types"

interface Props {
  value?: ArticleVideoScriptConfig
  businessFallback?: string
  onChange: (value: ArticleVideoScriptConfig) => void
}

export default function ArticleVideoScriptSettings({
  value,
  businessFallback = "",
  onChange,
}: Props) {
  const config = normalizeArticleVideoScriptConfig(value, {
    coreProductService: businessFallback,
  })

  function update<K extends keyof ArticleVideoScriptConfig>(
    key: K,
    next: ArticleVideoScriptConfig[K],
  ) {
    onChange({ ...config, [key]: next })
  }

  return (
    <div className="space-y-3 border-y border-blue-100 py-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-[#0958D9]">
        <Film className="h-3.5 w-3.5" />
        单问题视频配置
      </div>

      <Label className="text-xs">
        <span className="mb-1.5 block font-medium text-slate-500">核心产品 / 服务</span>
        <Input
          value={config.coreProductService}
          onChange={event => update("coreProductService", event.target.value)}
          placeholder={businessFallback || "填写本条文案对应的产品或服务"}
          className="h-10 rounded-lg bg-white"
        />
      </Label>

      <div className="grid gap-3 sm:grid-cols-2">
        <Label className="text-xs">
          <span className="mb-1.5 flex items-center gap-1.5 font-medium text-slate-500">
            <Film className="h-3.5 w-3.5" />
            发布平台
          </span>
          <Select
            value={config.platform}
            onChange={event => update("platform", event.target.value as ArticleVideoScriptConfig["platform"])}
          >
            {ARTICLE_VIDEO_PLATFORM_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </Label>
        {config.platform === "other" ? (
          <Label className="text-xs">
            <span className="mb-1.5 block font-medium text-slate-500">平台名称</span>
            <Input
              value={config.customPlatform || ""}
              onChange={event => update("customPlatform", event.target.value)}
              placeholder="填写发布平台"
              className="h-10 rounded-lg bg-white"
            />
          </Label>
        ) : (
          <Label className="text-xs">
            <span className="mb-1.5 flex items-center gap-1.5 font-medium text-slate-500">
              <Languages className="h-3.5 w-3.5" />
              输出语言
            </span>
            <Input
              value={config.outputLanguage}
              onChange={event => update("outputLanguage", event.target.value)}
              placeholder="简体中文"
              className="h-10 rounded-lg bg-white"
            />
          </Label>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {config.platform === "other" && (
          <Label className="text-xs">
            <span className="mb-1.5 flex items-center gap-1.5 font-medium text-slate-500">
              <Languages className="h-3.5 w-3.5" />
              输出语言
            </span>
            <Input
              value={config.outputLanguage}
              onChange={event => update("outputLanguage", event.target.value)}
              placeholder="简体中文"
              className="h-10 rounded-lg bg-white"
            />
          </Label>
        )}
        <Label className="text-xs">
          <span className="mb-1.5 block font-medium text-slate-500">语言风格 / 地区口吻</span>
          <Input
            value={config.languageStyle}
            onChange={event => update("languageStyle", event.target.value)}
            placeholder="自然普通话口语"
            className="h-10 rounded-lg bg-white"
          />
        </Label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Label className="text-xs">
          <span className="mb-1.5 flex items-center gap-1.5 font-medium text-slate-500">
            <Clock3 className="h-3.5 w-3.5" />
            目标时长（秒）
          </span>
          <Input
            type="number"
            min={15}
            max={180}
            step={5}
            value={config.targetDurationSeconds}
            onChange={event => update("targetDurationSeconds", Number(event.target.value))}
            className="h-10 rounded-lg bg-white"
          />
        </Label>
        <Label className="text-xs">
          <span className="mb-1.5 flex items-center gap-1.5 font-medium text-slate-500">
            <Hash className="h-3.5 w-3.5" />
            标签数量
          </span>
          <Input
            type="number"
            min={1}
            max={30}
            value={config.tagCount}
            onChange={event => update("tagCount", Number(event.target.value))}
            className="h-10 rounded-lg bg-white"
          />
        </Label>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-slate-500">行动引导</div>
        <div className="geo-segmented grid grid-cols-3">
          {([
            ["auto", "自动判断"],
            ["required", "需要"],
            ["disabled", "不需要"],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => update("ctaMode", mode)}
              className={`h-9 rounded-lg text-xs font-semibold transition ${
                config.ctaMode === mode
                  ? "bg-white text-[#0958D9] shadow-sm"
                  : "text-slate-500 hover:bg-white/70"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Database className="h-3.5 w-3.5" />
          资料范围
        </div>
        <div className="geo-segmented grid grid-cols-2">
          <button
            type="button"
            onClick={() => update("evidencePolicy", "clientMaterialsOnly")}
            className={`h-9 rounded-lg text-xs font-semibold transition ${
              config.evidencePolicy === "clientMaterialsOnly"
                ? "bg-white text-[#0958D9] shadow-sm"
                : "text-slate-500 hover:bg-white/70"
            }`}
          >
            当前客户资料
          </button>
          <button
            type="button"
            onClick={() => update("evidencePolicy", "verifiedPublicSupplement")}
            className={`h-9 rounded-lg text-xs font-semibold transition ${
              config.evidencePolicy === "verifiedPublicSupplement"
                ? "bg-white text-[#0958D9] shadow-sm"
                : "text-slate-500 hover:bg-white/70"
            }`}
          >
            补充公开资料
          </button>
        </div>
      </div>

      <Label className="text-xs">
        <span className="mb-1.5 block font-medium text-slate-500">本期必须使用的素材</span>
        <Textarea
          value={config.requiredMaterials}
          onChange={event => update("requiredMaterials", event.target.value)}
          placeholder="填写本条可使用的视频、图片或素材说明"
          className="min-h-[82px] rounded-lg bg-white"
        />
      </Label>

      <Label className="text-xs">
        <span className="mb-1.5 block font-medium text-slate-500">已发布 / 已生成内容</span>
        <Textarea
          value={config.priorContentSummary}
          onChange={event => update("priorContentSummary", event.target.value)}
          placeholder="填写已用标题或内容角度，用于避免重复"
          className="min-h-[82px] rounded-lg bg-white"
        />
      </Label>

      <Label className="text-xs">
        <span className="mb-1.5 flex items-center gap-1.5 font-medium text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5" />
          特殊合规要求
        </span>
        <Textarea
          value={config.complianceRequirements}
          onChange={event => update("complianceRequirements", event.target.value)}
          placeholder="填写行业禁用表达、审核要求或必须保留的事实边界"
          className="min-h-[82px] rounded-lg bg-white"
        />
      </Label>
    </div>
  )
}
