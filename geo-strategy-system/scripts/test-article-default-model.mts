import assert from "node:assert/strict"

const {
  chooseDefaultArticleModel,
  normalizeArticleModelProviderKey,
} = await import("../src/lib/article-models")
const {
  hasExplicitArticleModelSelection,
} = await import("../src/lib/article-model-default")

function provider(
  key: "article" | "doubao" | "deepseek",
  hasApiKey: boolean,
  model: string,
) {
  return {
    key,
    label: key,
    description: "",
    baseUrl: "https://example.com",
    chatPath: "/v1/chat/completions",
    model,
    timeout: 300,
    hasApiKey,
    apiKeyPreview: "",
    extra: {},
    extraFields: [],
    presets: [],
  }
}

assert.equal(normalizeArticleModelProviderKey(undefined), "doubao")
assert.equal(normalizeArticleModelProviderKey("unknown"), "doubao")
assert.equal(normalizeArticleModelProviderKey("qwen"), "qwen")
assert.equal(hasExplicitArticleModelSelection(undefined), false)
assert.equal(hasExplicitArticleModelSelection({ modelProvider: "article" }), false)
assert.equal(hasExplicitArticleModelSelection({ modelProvider: "qwen" }), true)
assert.equal(hasExplicitArticleModelSelection({
  modelProvider: "article",
  modelSelectionSource: "user",
}), true)

const preferred = chooseDefaultArticleModel({
  providers: [
    provider("article", true, "deepseek-chat"),
    provider("doubao", true, "ep-doubao"),
  ],
  gateways: [],
})
assert.deepEqual(preferred, {
  providerKey: "doubao",
  model: "ep-doubao",
  preferredProviderAvailable: true,
})

const fallback = chooseDefaultArticleModel({
  providers: [
    provider("article", true, "deepseek-chat"),
    provider("doubao", false, ""),
  ],
  gateways: [],
})
assert.deepEqual(fallback, {
  providerKey: "article",
  model: "deepseek-chat",
  preferredProviderAvailable: false,
})

const unconfigured = chooseDefaultArticleModel({
  providers: [provider("doubao", false, "doubao-seed")],
  gateways: [],
})
assert.deepEqual(unconfigured, {
  providerKey: "doubao",
  model: "doubao-seed",
  preferredProviderAvailable: false,
})

console.log("article default model tests passed")
