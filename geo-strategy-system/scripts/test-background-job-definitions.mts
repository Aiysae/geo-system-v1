import assert from "node:assert/strict"
import type { BackgroundJobKind } from "../src/types"
import type { BackgroundJobEstimate } from "../src/lib/background-jobs"

const { estimateBackgroundJob, isBackgroundJobKind } = await import("../src/lib/background-jobs")

// Captured from the public API before extraction. These are billing and routing
// contracts, including default counts, custom allocation and competitor limits.
const cases = [
  {"kind": "articleGeneration", "payload": {"promptKey": "selectionPitfallGuide"}, "expected": {"endpoint": "/api/article-generation", "featureKey": "articleSelectionPitfallGuide", "units": 1, "label": "文章生成 · 选型避坑指南", "credits": 8}},
  {"kind": "articleGeneration", "payload": {"promptKey": "rewrite"}, "expected": {"endpoint": "/api/article-generation", "featureKey": "articleRewrite", "units": 1, "label": "文章生成 · 文章改写", "credits": 8}},
  {"kind": "articleGeneration", "payload": {"promptKey": "shortVideoScript"}, "expected": {"endpoint": "/api/article-generation", "featureKey": "articleShortVideoScript", "units": 1, "label": "文章生成 · 多模态视频文案", "credits": 2}},
  {"kind": "queryGeneration", "payload": {}, "expected": {"endpoint": "/api/generate-queries", "featureKey": "legacyQueryGenerateUnit", "units": 28, "label": "旧版疑问句生成", "credits": 28}},
  {"kind": "queryGeneration", "payload": {"count": 200}, "expected": {"endpoint": "/api/generate-queries", "featureKey": "legacyQueryGenerateUnit", "units": 84, "label": "旧版疑问句生成", "credits": 84}},
  {"kind": "queryGeneration", "payload": {"count": -2}, "expected": {"endpoint": "/api/generate-queries", "featureKey": "legacyQueryGenerateUnit", "units": 1, "label": "旧版疑问句生成", "credits": 1}},
  {"kind": "queryGeneration", "payload": {"allocationMode": "custom", "categoryCounts": {"a": 2.9, "b": -3, "c": "4"}}, "expected": {"endpoint": "/api/generate-queries", "featureKey": "legacyQueryGenerateUnit", "units": 6, "label": "旧版疑问句生成", "credits": 6}},
  {"kind": "queryGeneration", "payload": {"allocationMode": "custom", "categoryCounts": {"a": 0}, "count": 12}, "expected": {"endpoint": "/api/generate-queries", "featureKey": "legacyQueryGenerateUnit", "units": 12, "label": "旧版疑问句生成", "credits": 12}},
  {"kind": "research", "payload": {}, "expected": {"endpoint": "/api/research", "featureKey": "researchAi", "units": 1, "label": "独立调研 · AI 调研", "credits": 8}},
  {"kind": "research", "payload": {"mode": "hypothesis"}, "expected": {"endpoint": "/api/research", "featureKey": "researchHypothesis", "units": 1, "label": "独立调研 · 假设验证", "credits": 5}},
  {"kind": "diagnosis", "payload": null, "expected": {"endpoint": "/api/diagnose", "featureKey": "diagnose", "units": 1, "label": "AI 诊断", "credits": 1}},
  {"kind": "competitorCompare", "payload": {}, "expected": {"endpoint": "/api/competitor-compare", "featureKey": "competitorCompareUnit", "units": 1, "label": "竞品对比", "credits": 5}},
  {"kind": "competitorCompare", "payload": {"selectedCompetitors": ["a", "", "b", null]}, "expected": {"endpoint": "/api/competitor-compare", "featureKey": "competitorCompareUnit", "units": 2, "label": "竞品对比", "credits": 10}},
  {"kind": "competitorCompare", "payload": {"selectedCompetitors": ["a", "b", "c", "d", "e", "f"]}, "expected": {"endpoint": "/api/competitor-compare", "featureKey": "competitorCompareUnit", "units": 5, "label": "竞品对比", "credits": 25}},
  {"kind": "keywordExtract", "payload": {}, "expected": {"endpoint": "/api/geo-strategy/extract", "featureKey": "keywordExtract", "units": 1, "label": "关键词策略 · 资料抽取", "credits": 2}},
  {"kind": "knowledgeImport", "payload": {}, "expected": {"endpoint": "/api/geo-strategy/extract", "featureKey": "keywordExtract", "units": 1, "label": "关键词策略 · 资料抽取", "credits": 2}},
  {"kind": "keywordAdvantages", "payload": {}, "expected": {"endpoint": "/api/geo-strategy/advantages", "featureKey": "keywordAdvantages", "units": 1, "label": "关键词策略 · 优势生成", "credits": 2}},
  {"kind": "keywordStrategy", "payload": {}, "expected": {"endpoint": "/api/geo-strategy/generate", "featureKey": "keywordStrategyGenerate", "units": 1, "label": "关键词策略 · 策略生成", "credits": 5}},
  {"kind": "keywordWebsitePrompt", "payload": {}, "expected": {"endpoint": "/api/geo-strategy/website-prompt", "featureKey": "keywordWebsitePrompt", "units": 1, "label": "关键词策略 · 网站 Prompt 生成", "credits": 3}},
] satisfies Array<{ kind: BackgroundJobKind; payload: unknown; expected: BackgroundJobEstimate }>

for (const { kind, payload, expected } of cases) {
  assert.equal(isBackgroundJobKind(kind), true)
  assert.deepEqual(estimateBackgroundJob(kind, payload), expected, `${kind}: ${JSON.stringify(payload)}`)
}
for (const value of [undefined, null, "", "unknown", 0, {}]) {
  assert.equal(isBackgroundJobKind(value), false)
}
for (const payload of [{}, { promptKey: "invalid" }]) {
  assert.throws(() => estimateBackgroundJob("articleGeneration", payload), /请选择有效的文章 Prompt/)
}
console.log(`Background job definition contracts passed: ${cases.length} estimates, invalid kinds and prompts.`)
