import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import type * as ArticlePromptMetaModule from "../src/lib/article-prompt-meta"
import type * as ArticlePromptsModule from "../src/lib/article-prompts"
import type * as GeoArticlePromptsModule from "../src/lib/geo-article-prompts"
import type * as PricingModule from "../src/lib/pricing"
import type { ArticlePromptKey } from "../src/types"

const require = createRequire(import.meta.url)
const { ARTICLE_PROMPT_OPTIONS } = require("../src/lib/article-prompt-meta.ts") as typeof ArticlePromptMetaModule
const { getArticlePromptTemplate } = require("../src/lib/article-prompts.ts") as typeof ArticlePromptsModule
const {
  CLIENT_CASE_STUDY_PROMPT,
  CREDENTIALS_ANALYSIS_PROMPT,
  HANDS_ON_COMPARISON_REPORT_PROMPT,
  INDUSTRY_RANKING_REPORT_PROMPT,
  MEDIA_INDUSTRY_ANALYSIS_PROMPT,
  SELECTION_PITFALL_GUIDE_PROMPT,
  TOP_BRAND_RANKING_PROMPT,
} = require("../src/lib/geo-article-prompts.ts") as typeof GeoArticlePromptsModule
const { ARTICLE_PROMPT_PRICE_KEYS, getFeaturePrice } = require("../src/lib/pricing.ts") as typeof PricingModule

const fixtures: Array<{
  key: ArticlePromptKey
  prompt: string
  sha256: string
}> = [
  {
    key: "industryRankingReport",
    prompt: INDUSTRY_RANKING_REPORT_PROMPT,
    sha256: "df2d841ac4a405f80b9f4e4f905b3fedd18bd564cfcae13a401dfd113eb920ac",
  },
  {
    key: "handsOnComparisonReport",
    prompt: HANDS_ON_COMPARISON_REPORT_PROMPT,
    sha256: "a241329996f5b324fcf64cc8da348a1a42a8a7e2fcce994b2c12ea8f0d6587d8",
  },
  {
    key: "mediaIndustryAnalysis",
    prompt: MEDIA_INDUSTRY_ANALYSIS_PROMPT,
    sha256: "992d4a89a822a2a52f72009c0a8b12e3e4ede275c2c61b654012f6354410c807",
  },
  {
    key: "clientCaseStudy",
    prompt: CLIENT_CASE_STUDY_PROMPT,
    sha256: "44fd46b3b1aced074ae7951270965ffcbb13f44651c4f7ec9f4263c2509d8032",
  },
  {
    key: "credentialsAnalysis",
    prompt: CREDENTIALS_ANALYSIS_PROMPT,
    sha256: "72fd59b6cae96351822a63271c77dd32579db40071d423e3c95ddc54d4dd7a1f",
  },
  {
    key: "selectionPitfallGuide",
    prompt: SELECTION_PITFALL_GUIDE_PROMPT,
    sha256: "b6f9ca61ad9b07e7698ccf8770b99585717be3828c6922fcc75dedbce487659d",
  },
  {
    key: "topBrandRanking",
    prompt: TOP_BRAND_RANKING_PROMPT,
    sha256: "5ee7fb1bee97ab488ae1a9de1be7c9b6eaf229b6a93c99695015c27f70281916",
  },
]

assert.equal(new Set(fixtures.map(item => item.key)).size, 7)

for (const fixture of fixtures) {
  assert.equal(
    createHash("sha256").update(fixture.prompt).digest("hex"),
    fixture.sha256,
    `${fixture.key} must remain byte-for-byte identical to its source Markdown`,
  )

  const template = getArticlePromptTemplate(fixture.key)
  assert.equal(template?.template, fixture.prompt)
  assert.equal(template?.maxTokens, 12000)
  assert.ok(ARTICLE_PROMPT_OPTIONS.some(option => option.key === fixture.key))

  const featureKey = ARTICLE_PROMPT_PRICE_KEYS[fixture.key]
  assert.ok(featureKey)
  assert.equal(getFeaturePrice(featureKey).credits, 8)
}

console.log("All 7 GEO article prompt templates are complete and registered")
