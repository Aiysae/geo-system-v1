import assert from "node:assert/strict"
const {
  buildArticleWebEnhancedPrompt,
  collectArticleWebContext,
} = await import("../src/lib/article-web-context")
const {
  DEFAULT_QUESTION_MODEL_PROVIDER,
  getDefaultQuestionModel,
  normalizeQuestionModelProvider,
} = await import("../src/types/geo-strategy")

const calls: string[] = []
const connected = await collectArticleWebContext({
  queries: ["第一条检索", "第二条检索", "不会执行"],
  maxAttempts: 3,
  search: async query => {
    calls.push(query)
    if (query === "第一条检索") return []
    return [
      {
        title: "最新行业资料",
        snippet: "这是与文章主题有关的实时公开信息。",
        url: "https://example.com/current",
      },
      {
        title: "重复资料",
        snippet: "同一网址不应重复注入。",
        url: "https://example.com/current",
      },
      {
        title: "无效链接",
        snippet: "本条应被过滤。",
        url: "data:image/png;base64,invalid",
      },
    ]
  },
})

assert.deepEqual(calls, ["第一条检索", "第二条检索"])
assert.equal(connected.attempts, 2)
assert.equal(connected.sourceCount, 1)
assert.equal(connected.fallbackReason, undefined)

const prompt = buildArticleWebEnhancedPrompt("请生成文章正文。", connected)
assert.match(prompt, /请生成文章正文/)
assert.match(prompt, /最新行业资料/)
assert.match(prompt, /不可信外部数据/)
assert.match(prompt, /不额外输出资料包/)

const failed = await collectArticleWebContext({
  queries: ["检索 A", "检索 B", "检索 C", "检索 D"],
  maxAttempts: 3,
  search: async () => [],
})
assert.equal(failed.attempts, 3)
assert.equal(failed.sourceCount, 0)
assert.match(failed.fallbackReason || "", /多次未返回/)

assert.equal(DEFAULT_QUESTION_MODEL_PROVIDER, "doubao")
assert.equal(normalizeQuestionModelProvider(undefined), "doubao")
assert.equal(normalizeQuestionModelProvider("qwen"), "qwen")
assert.match(getDefaultQuestionModel("doubao"), /^doubao-/)

console.log("Article web retries, safe context injection, fallback, and Doubao question defaults passed")
