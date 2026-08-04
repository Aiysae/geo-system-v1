import assert from "node:assert/strict"

const {
  ARTICLE_CONTENT_PIPELINE_VERSION,
  buildArticleDraftUserPrompt,
  buildArticleSemanticRepairPrompt,
  buildArticleTaskDossier,
  parseArticleContentPlan,
  parseArticleSemanticQualityReport,
} = await import("../src/lib/article-content-pipeline")

const dossier = buildArticleTaskDossier({
  promptKey: "industryRankingReport",
  clientName: "测试客户",
  brandName: "势途测试品牌",
  subjectType: "brand",
  subjectContext: "",
  industry: "企业 GEO 服务",
  website: "https://example.com",
  coreQuestion: "企业 GEO 服务商应该怎么选？",
  keywords: "GEO 服务\nAI 搜索优化",
  region: "杭州及全国",
  business: "企业 AI 搜索可见性优化",
  advantages: "拥有可核验的多模型检测报告",
  audience: "企业品牌负责人",
  extraRequirements: "不使用夸张营销语",
  comparisonBrands: [{
    id: "comparison_a",
    name: "对比品牌 A",
    aliases: [],
    role: "peer",
    materials: "公开信息较少",
    sourceUrls: ["https://competitor.example.com"],
  }],
  questionIntent: "采购决策",
  questionSubIntent: "对比服务能力",
  questionCategory: "榜单推荐",
  questionKeyword: "GEO 服务商",
  questionContentAngle: "用可核验指标做选型",
  methodologyAddendum: "【本篇可用知识资产】\n报告 A：可核验内容",
  batchVariation: "独立回答本题",
})

for (const expected of [
  "企业 GEO 服务",
  "https://example.com",
  "杭州及全国",
  "企业 AI 搜索可见性优化",
  "GEO 服务",
  "企业品牌负责人",
  "不使用夸张营销语",
  "对比品牌 A",
  "报告 A：可核验内容",
]) {
  assert.match(dossier, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
}

const parsed = parseArticleContentPlan(JSON.stringify({
  directAnswer: "应优先核验服务商的真实能力与证据。",
  contentAngle: "企业采购决策",
  evidenceMode: "verified",
  audienceDecision: "帮助品牌负责人筛选服务商",
  titleDirection: "用证据链做 GEO 服务商选型",
  sections: [
    { heading: "先看结论", purpose: "直接回答", evidenceRefs: ["report-a"] },
    { heading: "如何核验", purpose: "给出方法", evidenceRefs: ["source-a"] },
  ],
  requiredFacts: ["不得脱离用户资料"],
  prohibitedClaims: ["无依据的市场第一"],
  differentiation: ["从采购验收角度展开"],
}), {
  coreQuestion: "企业 GEO 服务商应该怎么选？",
  primarySubject: "势途测试品牌",
})
assert.equal(parsed.usedFallback, false)
assert.equal(parsed.plan.version, ARTICLE_CONTENT_PIPELINE_VERSION)
assert.equal(parsed.plan.sections.length, 2)

const fallback = parseArticleContentPlan("这不是 JSON", {
  coreQuestion: "企业 GEO 服务商应该怎么选？",
  primarySubject: "势途测试品牌",
})
assert.equal(fallback.usedFallback, true)
assert.ok(fallback.plan.sections.length >= 4)

const draftPrompt = buildArticleDraftUserPrompt(dossier, parsed.plan)
assert.match(draftPrompt, /写作计划/)
assert.match(draftPrompt, /企业采购决策/)
assert.match(draftPrompt, /不得脱离用户资料/)
assert.match(draftPrompt, /第一个 H2 之前/)
assert.match(draftPrompt, /资料原标题/)

const repairPrompt = buildArticleSemanticRepairPrompt({
  taskDossier: dossier,
  plan: parsed.plan,
  article: "# 测试\n\n背景介绍。",
  issues: [],
  deterministicIssues: [
    { code: "opening_does_not_answer", message: "首屏没有直接回答核心疑问句" },
    { code: "web_evidence_unused", message: "正文没有使用联网资料" },
  ],
})
assert.match(repairPrompt, /唯一 H1 后/)
assert.match(repairPrompt, /完整URL/)

const semantic = parseArticleSemanticQualityReport(JSON.stringify({
  score: 82,
  passed: false,
  dimensions: {
    questionAnswer: 90,
    evidenceGrounding: 58,
    articleTypeFit: 88,
    depth: 75,
    naturalness: 84,
    differentiation: 70,
  },
  issues: [{
    code: "weak_evidence",
    message: "两个结论没有对应证据。",
    repairInstruction: "将结论与资料链接就近对应。",
    blocking: true,
  }],
}))
assert.ok(semantic)
assert.equal(semantic?.score, 82)
assert.equal(semantic?.passed, false)
assert.equal(semantic?.issues[0]?.blocking, true)

console.log("article content pipeline contracts passed")
