import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import type * as ArticlePromptMetaModule from "../src/lib/article-prompt-meta"
import type * as ArticlePromptsModule from "../src/lib/article-prompts"
import type * as GeoArticlePromptsModule from "../src/lib/geo-article-prompts"
import type * as PricingModule from "../src/lib/pricing"
import type * as BrandVideoPromptModule from "../src/lib/brand-video-script-prompt"
import type { ArticlePromptKey } from "../src/types"

const require = createRequire(import.meta.url)
const { ARTICLE_PROMPT_OPTIONS } = require("../src/lib/article-prompt-meta.ts") as typeof ArticlePromptMetaModule
const {
  getArticlePromptTemplate,
  LONGFORM_CONTENT_COMPILER_PROMPT,
} = require("../src/lib/article-prompts.ts") as typeof ArticlePromptsModule
const {
  CLIENT_CASE_STUDY_PROMPT,
  CREDENTIALS_ANALYSIS_PROMPT,
  EXPERT_QA_PROMPT,
  HANDS_ON_COMPARISON_REPORT_PROMPT,
  INDUSTRY_HOT_TOPIC_PROMPT,
  INDUSTRY_RANKING_REPORT_PROMPT,
  MEDIA_INDUSTRY_ANALYSIS_PROMPT,
  SELECTION_PITFALL_GUIDE_PROMPT,
  THIRD_PARTY_EVALUATION_PROMPT,
  TOP_BRAND_RANKING_PROMPT,
} = require("../src/lib/geo-article-prompts.ts") as typeof GeoArticlePromptsModule
const { ARTICLE_PROMPT_PRICE_KEYS, getFeaturePrice } = require("../src/lib/pricing.ts") as typeof PricingModule
const { BRAND_SINGLE_QUESTION_VIDEO_SCRIPT_PROMPT } = require("../src/lib/brand-video-script-prompt.ts") as typeof BrandVideoPromptModule

const fixtures: Array<{
  key: ArticlePromptKey
  title: string
  prompt: string
  sha256: string
  credits: number
}> = [
  {
    key: "thirdPartyObservation",
    title: "第三方测评 / 推荐观察",
    prompt: THIRD_PARTY_EVALUATION_PROMPT,
    sha256: "5e4867dce2865950280f333a670dcdc349472a8ecaa9572e2400cd119ce1c008",
    credits: 8,
  },
  {
    key: "pitfallGuide",
    title: "问题解决 / 专家答疑",
    prompt: EXPERT_QA_PROMPT,
    sha256: "30594f695a98f365ff25bda23801e865cf8222421b15c21ee3a88ddcdb3910b5",
    credits: 5,
  },
  {
    key: "competitorComparison",
    title: "竞品对比 / 行业观察",
    prompt: INDUSTRY_HOT_TOPIC_PROMPT,
    sha256: "f29dcf890ec591d6de9b1073b86144bdc627bdb6daf4c62780f37de3afb4297d",
    credits: 8,
  },
  {
    key: "industryRankingReport",
    title: "第三方行业排名 / 市场份额报告",
    prompt: INDUSTRY_RANKING_REPORT_PROMPT,
    sha256: "809b4e7fb8f1e00cab4c260510a591cd3333abaee5f56fd02e412586b39bc86b",
    credits: 8,
  },
  {
    key: "handsOnComparisonReport",
    title: "第三方实测 / 横评报告",
    prompt: HANDS_ON_COMPARISON_REPORT_PROMPT,
    sha256: "4ed22fd1e9534e01b76eaf698172d52f151970e34da13f189b0142bb68b09d0d",
    credits: 8,
  },
  {
    key: "mediaIndustryAnalysis",
    title: "权威媒体报道 / 行业解读",
    prompt: MEDIA_INDUSTRY_ANALYSIS_PROMPT,
    sha256: "c9889e24f9a73640b8e329753e6b66a1c4b2b6d2ae6c36511b442330e82dc1a7",
    credits: 8,
  },
  {
    key: "clientCaseStudy",
    title: "客户案例 / 招投标合作案例",
    prompt: CLIENT_CASE_STUDY_PROMPT,
    sha256: "ad215db1e604d79e16403a92cd76db9c5b2ccb65800f648edd4c1c58474d8a28",
    credits: 8,
  },
  {
    key: "credentialsAnalysis",
    title: "标准认证 / 专利奖项解读",
    prompt: CREDENTIALS_ANALYSIS_PROMPT,
    sha256: "de960cc566792a6063f02331814512b3bb7c739c07dda74b45c820fe94208542",
    credits: 8,
  },
  {
    key: "selectionPitfallGuide",
    title: "选型指南 / 避坑指南",
    prompt: SELECTION_PITFALL_GUIDE_PROMPT,
    sha256: "e9416599d0034241cffdd562dd604b4ac29e4ccabe7789bb3aebe37d6ab3d2b3",
    credits: 8,
  },
  {
    key: "topBrandRanking",
    title: "Top 榜单 / 对比清单",
    prompt: TOP_BRAND_RANKING_PROMPT,
    sha256: "bf50877025678c52168ea53b32810286ab6dfd9e3df5dcc6e5c72487f7312f81",
    credits: 8,
  },
]

assert.equal(new Set(fixtures.map(item => item.key)).size, 10)
const previousMethodologyVersion = process.env.GEO_METHODOLOGY_VERSION
const activeLongformTemplates = new Set<string>()

for (const fixture of fixtures) {
  assert.equal(
    createHash("sha256").update(fixture.prompt).digest("hex"),
    fixture.sha256,
    `${fixture.key} must match the normalized latest source file`,
  )
  assert.ok(fixture.prompt.includes("{{核心疑问句}}"))
  assert.ok(fixture.prompt.includes("{{优势}}"))
  assert.ok(fixture.prompt.includes("{{品牌名或个人IP的名字}}"))
  assert.doesNotMatch(fixture.prompt, /\{\{(?:行业|品牌名称|品牌资料包|具体优势|人物资料包|人物姓名)\}\}/u)

  delete process.env.GEO_METHODOLOGY_VERSION
  const template = getArticlePromptTemplate(fixture.key)
  assert.ok(template?.template.includes(LONGFORM_CONTENT_COMPILER_PROMPT))
  assert.ok(template?.template.includes(fixture.prompt))
  assert.notEqual(template?.template, LONGFORM_CONTENT_COMPILER_PROMPT)
  activeLongformTemplates.add(template?.template || "")
  assert.equal(template?.maxTokens, 12000)

  process.env.GEO_METHODOLOGY_VERSION = "legacy"
  assert.equal(getArticlePromptTemplate(fixture.key)?.template, fixture.prompt)

  const option = ARTICLE_PROMPT_OPTIONS.find(item => item.key === fixture.key)
  assert.equal(option?.title, fixture.title)

  const featureKey = ARTICLE_PROMPT_PRICE_KEYS[fixture.key]
  assert.ok(featureKey)
  assert.equal(getFeaturePrice(featureKey).credits, fixture.credits)
}
assert.equal(activeLongformTemplates.size, fixtures.length)
if (previousMethodologyVersion === undefined) delete process.env.GEO_METHODOLOGY_VERSION
else process.env.GEO_METHODOLOGY_VERSION = previousMethodologyVersion

const generationPrompts = ARTICLE_PROMPT_OPTIONS.filter(option => option.key !== "rewrite")
assert.equal(generationPrompts.length, 12)
assert.ok(generationPrompts.some(option => option.key === "shortVideoScript"))
assert.equal(
  createHash("sha256").update(getArticlePromptTemplate("shortVideoScript")?.template || "").digest("hex"),
  "4f94970dc9a38db530b20a01f6711e73cbfe1f6bb9b65a9ffa73a81f0873ea04",
  "short-video prompt must remain unchanged",
)

const brandVideoTemplate = getArticlePromptTemplate("brandSingleQuestionVideoScript")
const brandVideoOption = ARTICLE_PROMPT_OPTIONS.find(
  option => option.key === "brandSingleQuestionVideoScript",
)
assert.equal(brandVideoTemplate?.template, BRAND_SINGLE_QUESTION_VIDEO_SCRIPT_PROMPT)
assert.equal(brandVideoTemplate?.maxTokens, 4096)
assert.equal(brandVideoOption?.contentKind, "video_script")
assert.deepEqual(brandVideoOption?.supportedModes, ["single", "batch", "strategy"])
assert.equal(
  getFeaturePrice(ARTICLE_PROMPT_PRICE_KEYS.brandSingleQuestionVideoScript).credits,
  2,
)
assert.match(BRAND_SINGLE_QUESTION_VIDEO_SCRIPT_PROMPT, /一条视频只解决一个核心疑问/)
assert.match(BRAND_SINGLE_QUESTION_VIDEO_SCRIPT_PROMPT, /【本条采用的专业视角】/)
assert.match(BRAND_SINGLE_QUESTION_VIDEO_SCRIPT_PROMPT, /【标签】/)

console.log("All article prompts are registered; long-form rollback and the original short-video prompt remain intact")
