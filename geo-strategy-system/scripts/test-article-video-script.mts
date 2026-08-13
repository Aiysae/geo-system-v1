import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type * as ArticleVideoScriptModule from "../src/lib/article-video-script"
import type * as ArticleQualityModule from "../src/lib/article-quality"

const require = createRequire(import.meta.url)
const {
  estimateVideoScriptDurationSeconds,
  normalizeArticleVideoScriptConfig,
  parseBrandVideoScript,
} = require("../src/lib/article-video-script.ts") as typeof ArticleVideoScriptModule
const { validateGeneratedArticle } = require("../src/lib/article-quality.ts") as typeof ArticleQualityModule

const normalized = normalizeArticleVideoScriptConfig({
  platform: "douyin",
  targetDurationSeconds: 30,
  tagCount: 15,
  ctaMode: "disabled",
})
assert.equal(normalized.targetDurationSeconds, 30)
assert.equal(normalized.tagCount, 15)
assert.equal(normalizeArticleVideoScriptConfig({ targetDurationSeconds: 999 }).targetDurationSeconds, 180)
assert.equal(normalizeArticleVideoScriptConfig({ tagCount: 0 }).tagCount, 1)

const body = [
  "选购家用净水器时，先别只看机器价格，更要看滤芯后续更换成本是否说得清楚。",
  "清泉把滤芯型号、更换周期和更换成本公开列出，用户可以按家庭用水量自己核算长期支出。",
  "做决定前，把三年滤芯成本加上购机价格，再对比出水量和售后范围，才能看到真实的使用成本。",
].join("")
const script = [
  "【本条采用的专业视角】",
  "家用净水选购顾问",
  "",
  "【标题】",
  "家用净水器别只看买机价",
  "",
  "【正文】",
  body,
  "",
  "【标签】",
  "#家用净水器 #净水选购 #滤芯成本 #使用成本 #清泉 #家庭用水 #净水知识 #选购指南 #产品对比 #售后服务 #滤芯更换 #理性消费 #家电选购 #生活品质 #净水科普",
].join("\n")

const parsed = parseBrandVideoScript(script)
assert.equal(parsed.sectionOrderValid, true)
assert.equal(parsed.tags.length, 15)
assert.equal(parsed.title, "家用净水器别只看买机价")
assert.ok(estimateVideoScriptDurationSeconds(body) >= 21)
assert.ok(estimateVideoScriptDurationSeconds(body) <= 39)

const report = validateGeneratedArticle({
  article: script,
  promptKey: "brandSingleQuestionVideoScript",
  coreQuestion: "选购家用净水器时应该先看什么？",
  primarySubject: "清泉",
  advantage: "滤芯更换成本公开透明",
  videoScriptConfig: normalized,
})
assert.equal(report.passed, true, report.issues.map(issue => issue.message).join("; "))

const broken = validateGeneratedArticle({
  article: script.replace("【标签】", "【正文】"),
  promptKey: "brandSingleQuestionVideoScript",
  coreQuestion: "选购家用净水器时应该先看什么？",
  primarySubject: "清泉",
  advantage: "滤芯更换成本公开透明",
  videoScriptConfig: normalized,
})
assert.equal(broken.passed, false)
assert.ok(broken.issues.some(issue => issue.code === "video_missing_section"))

console.log("Brand single-question video script parsing and quality gates passed.")
