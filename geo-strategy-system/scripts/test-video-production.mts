import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type * as GenerateModule from "../src/lib/video-production/generate"
import type * as OptionsModule from "../src/lib/video-production/options"

const require = createRequire(import.meta.url)
const { parseVideoScript, imageWithStyle } = require("../src/lib/video-production/generate.ts") as typeof GenerateModule
const { normalizeVideoProductionSettings } = require("../src/lib/video-production/options.ts") as typeof OptionsModule

const defaults = normalizeVideoProductionSettings({})
assert.equal(defaults.type, "slides")
assert.equal(defaults.imageModel, "z-image-turbo")
const clamped = normalizeVideoProductionSettings({ type: "avatar", targetSeconds: 999, tagCount: 1, imageModel: "dall-e", style: "x" })
assert.equal(clamped.type, "avatar")
assert.equal(clamped.targetSeconds, 180)
assert.equal(clamped.tagCount, 3)
assert.equal(clamped.imageModel, "z-image-turbo")
assert.equal(clamped.style, "photo")

const slides = parseVideoScript("```json\n" + JSON.stringify({
  perspective: "行业顾问",
  title: "✅ 监理公司怎么选？",
  coverTitle: "监理公司\\n怎么选",
  coverImageBrief: "工地远景",
  description: "简介",
  tags: ["监理", "#监理", "#工程 咨询", ""],
  segments: [
    { voiceover: "第一句口播内容。", screenText: "📍 持有综合资质", imageBrief: "", seconds: 30 },
    { voiceover: "第二句口播内容，稍微长一点点。", screenText: "看业绩", imageBrief: "工程现场" },
    { voiceover: "" },
  ],
}) + "\n```", { ...defaults, tagCount: 5 })
assert.equal(slides.title, "监理公司怎么选？")
assert.equal(slides.coverTitle, "监理公司\n怎么选")
assert.deepEqual(slides.tags, ["#监理", "#工程咨询"])
assert.equal(slides.segments.length, 2, "empty voiceovers are dropped")
assert.equal(slides.segments[0].screenText, "持有综合资质", "emoji is removed from on-screen words")
assert.equal(slides.segments[0].imageBrief, "持有综合资质，第一句口播内容。", "missing image briefs fall back to the page text")
assert.ok(slides.segments[0].seconds >= 4 && slides.segments[0].seconds < 30, "timing follows the spoken text")
assert.equal(slides.estimatedSeconds, slides.segments.reduce((sum, segment) => sum + segment.seconds, 0))

const avatar = parseVideoScript(JSON.stringify({
  title: "标题",
  segments: [
    { voiceover: "一", action: "走动", broll: "", screenText: "不该出现" },
    { voiceover: "二", action: "停步" },
  ],
}), clamped)
assert.equal(avatar.segments[0].screenText, undefined)
assert.equal(avatar.segments[0].action, "走动")
assert.equal(avatar.coverTitle, "标题")

assert.throws(() => parseVideoScript("没有 JSON", defaults), /JSON/)
assert.throws(() => parseVideoScript(JSON.stringify({ title: "", segments: [] }), defaults), /标题/)

const styled = imageWithStyle("工地远景，", defaults)
assert.equal(styled.startsWith("工地远景，真实摄影质感"), true)
assert.equal(imageWithStyle(styled, defaults), styled, "the style is appended once")

console.log("video production tests passed")
