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

const { default: ArticleStrategyWorkspace } = await import(
  "../src/components/article/article-strategy-workspace"
)
const container = document.getElementById("root")!
const root = createRoot(container)

await act(async () => {
  root.render(React.createElement(ArticleStrategyWorkspace, {
    clientId: "client_strategy_filter",
    questions: [
      {
        id: "direct",
        question: "杭州全屋定制哪家好？",
        category: "榜单推荐型",
        difficulty: "中等",
        keyword: "杭州全屋定制",
        intent: "直接寻找值得选择的公司",
        content_angle: "品牌推荐",
        queryStyle: "local",
        matched_advantage: "有公开案例可核验",
      },
      {
        id: "conditional",
        question: "预算有限，杭州装修公司哪家好？",
        category: "榜单推荐型",
        difficulty: "中等",
        keyword: "杭州装修公司",
        intent: "条件推荐",
        content_angle: "预算选型",
        matched_advantage: "价格透明",
      },
      {
        id: "other",
        question: "装修合同怎么避免增项？",
        category: "风险疑虑型",
        difficulty: "中等",
        keyword: "装修合同",
        intent: "避坑",
        content_angle: "合同审查",
        matched_advantage: "阶段验收",
      },
    ],
    importedMaterials: [],
    basePayload: {},
    hasAccess: true,
    membershipTier: "vip3",
    onStarted: () => undefined,
  }))
})

assert.match(container.textContent || "", /已选 3\/3/)
const directFilter = [...container.querySelectorAll("button")]
  .find(button => button.textContent?.includes("直推榜单 1")) as HTMLButtonElement | undefined
assert.ok(directFilter)
await act(async () => directFilter.click())
assert.match(container.textContent || "", /杭州全屋定制哪家好/)
assert.doesNotMatch(container.textContent || "", /装修合同怎么避免增项/)

const selectCurrent = [...container.querySelectorAll("button")]
  .find(button => button.textContent?.includes("只选当前筛选")) as HTMLButtonElement | undefined
assert.ok(selectCurrent)
await act(async () => selectCurrent.click())
assert.match(container.textContent || "", /已选 1\/3/)

await act(async () => root.unmount())
console.log("article strategy question filter tests passed")
