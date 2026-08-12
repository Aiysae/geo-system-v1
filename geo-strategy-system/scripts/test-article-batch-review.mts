import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import React from "react"
import { createRoot } from "react-dom/client"

const { act } = React
const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  url: "https://shitugeo.top/workspace",
})

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  MutationObserver: dom.window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
})
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
})

const audit = {
  pipelineVersion: "test",
  planUsedFallback: false,
  evidenceMode: "framework",
  plannedSectionCount: 4,
  deterministicScore: 62,
  repaired: true,
  finalPassed: false,
  issues: ["证据说明不足"],
}
const batch = {
  id: "batch_review_ui",
  clientId: "client_review_ui",
  promptKey: "thirdPartyObservation",
  promptTitle: "第三方观察",
  modelProvider: "article",
  model: "deepseek-chat",
  topicMode: "custom",
  similarityRetry: true,
  requestedCount: 3,
  completedCount: 2,
  passedCount: 1,
  directRecommendationPassedCount: 1,
  reviewRequiredCount: 1,
  failedCount: 1,
  cancelledCount: 0,
  status: "partial",
  stage: "已生成 2 篇，其中 1 篇待人工复核",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  items: [
    {
      id: "item_passed",
      position: 1,
      topic: "通过文章",
      brief: "通过文章",
      status: "succeeded",
      qualityStatus: "passed",
      questionSource: "keyword_strategy",
      questionSelectionType: "direct_recommendation",
      questionSelectionReason: "问题直接询问推荐对象",
      hasDraft: true,
      progressPercent: 100,
      stage: "质检通过",
      attempt: 1,
      updatedAt: new Date().toISOString(),
    },
    {
      id: "item_review",
      position: 2,
      topic: "待复核文章",
      brief: "待复核文章",
      status: "succeeded",
      qualityStatus: "review_required",
      questionSource: "keyword_strategy",
      questionSelectionType: "long_tail",
      hasDraft: true,
      qualityAudit: audit,
      progressPercent: 100,
      stage: "等待人工复核",
      attempt: 1,
      updatedAt: new Date().toISOString(),
    },
    {
      id: "item_failed",
      position: 3,
      topic: "技术失败文章",
      brief: "技术失败文章",
      status: "failed",
      qualityStatus: "not_available",
      hasDraft: false,
      progressPercent: 100,
      stage: "生成失败",
      error: "接口超时",
      attempt: 1,
      updatedAt: new Date().toISOString(),
    },
  ],
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json" },
})

globalThis.fetch = async input => {
  const url = String(input)
  if (url.includes("/items/item_review")) {
    return json({
      id: "item_review",
      title: "待复核文章",
      topic: "待复核文章",
      markdown: "# 待复核文章\n\n这是需要人工重新判断的完整正文。",
      status: "succeeded",
      qualityStatus: "review_required",
      qualityAudit: audit,
      promptTitle: "第三方观察",
      model: "deepseek-chat",
    })
  }
  if (url.includes("/api/article-generation/batches?")) return json({ batches: [batch] })
  return json({ error: `unexpected request: ${url}` }, 500)
}

const { default: ArticleBatchWorkspace } = await import("../src/components/article/article-batch-workspace")
const container = document.getElementById("root")!
const root = createRoot(container)

async function waitFor(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    if (check()) return
  }
  throw new Error(message)
}

await act(async () => {
  root.render(React.createElement(ArticleBatchWorkspace, {
    clientId: "client_review_ui",
    promptTitle: "第三方观察",
    basePayload: { coreQuestion: "测试问题" },
    keywordQuestions: [],
    perArticleCredits: 1,
  }))
})
await waitFor(
  () => container.textContent?.includes("下载全部（含待复核）2 篇") === true,
  "未显示全部文章下载按钮",
)
assert.match(container.textContent || "", /仅下载质检通过 1 篇/)
assert.match(container.textContent || "", /下载直推榜单 1 篇/)
assert.match(container.textContent || "", /待人工复核/)
assert.equal(
  container.querySelector('a[href$="download?scope=all"]')?.textContent?.includes("下载全部"),
  true,
)
assert.equal(
  container.querySelector('a[href$="download?scope=passed"]')?.textContent?.includes("质检通过"),
  true,
)
assert.equal(
  container.querySelector('a[href$="download?scope=direct"]')?.textContent?.includes("直推榜单"),
  true,
)

const filterButtons = [...container.querySelectorAll("button")]
const directFilter = filterButtons.find(button => button.textContent?.includes("直推榜单 1")) as HTMLButtonElement | undefined
assert.ok(directFilter)
await act(async () => directFilter.click())
assert.ok(container.querySelector('button[aria-label="查看第 1 篇文章"]'))
assert.equal(container.querySelector('button[aria-label="查看第 2 篇文章"]'), null)
const allFilter = [...container.querySelectorAll("button")]
  .find(button => button.textContent?.includes("全部结果 3")) as HTMLButtonElement | undefined
assert.ok(allFilter)
await act(async () => allFilter.click())

const reviewButton = container.querySelector(
  'button[aria-label="查看第 2 篇文章"]',
) as HTMLButtonElement | null
assert.ok(reviewButton)
await act(async () => reviewButton.click())
await waitFor(
  () => document.body.textContent?.includes("系统质检未通过，请人工确认后使用") === true,
  "待人工复核正文预览未打开",
)
assert.match(document.body.textContent || "", /这是需要人工重新判断的完整正文/)
assert.match(document.body.textContent || "", /证据说明不足/)

await act(async () => root.unmount())
console.log("article batch review UI tests passed")
