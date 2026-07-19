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

type BatchStatus = "running" | "cancelled"

function batch(id: string, status: BatchStatus) {
  const cancelled = status === "cancelled"
  return {
    id,
    clientId: "client_restart_test",
    promptKey: "thirdPartyObservation",
    promptTitle: "第三方检测",
    modelProvider: "article",
    model: "deepseek-chat",
    topicMode: "auto",
    similarityRetry: true,
    requestedCount: 2,
    completedCount: 0,
    failedCount: 0,
    cancelledCount: cancelled ? 2 : 0,
    status,
    stage: cancelled ? "批量生成已停止" : "后台生成中",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: cancelled ? new Date().toISOString() : undefined,
    items: [1, 2].map(position => ({
      id: `${id}_item_${position}`,
      position,
      topic: `主题 ${position}`,
      brief: `独立主题 ${position}`,
      status: cancelled ? "cancelled" : "running",
      progressPercent: cancelled ? 100 : 20,
      stage: cancelled ? "任务已停止" : "生成中",
      attempt: 1,
      updatedAt: new Date().toISOString(),
    })),
  }
}

let batches: ReturnType<typeof batch>[] = []
let createCalls = 0
const patchActions: string[] = []

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json" },
})

globalThis.fetch = async (input, init) => {
  const url = String(input)
  const method = String(init?.method || "GET").toUpperCase()
  if (url.includes("/api/article-generation/batches?") && method === "GET") {
    return json({ batches })
  }
  if (url.endsWith("/api/article-generation/batches") && method === "POST") {
    createCalls += 1
    const created = batch(`batch_created_${createCalls}`, "running")
    batches = [created, ...batches]
    return json(created, 202)
  }
  if (url.includes("/api/article-generation/batches/") && method === "PATCH") {
    const body = JSON.parse(String(init?.body || "{}")) as { action?: string }
    patchActions.push(String(body.action || ""))
    if (body.action === "cancel") {
      const cancelled = batch(batches[0].id, "cancelled")
      batches = [cancelled, ...batches.slice(1)]
      return json(cancelled)
    }
    if (body.action === "restart") {
      const restarted = batch("batch_restarted_2", "running")
      batches = [restarted, ...batches]
      return json(restarted, 202)
    }
  }
  return json({ error: `unexpected request: ${method} ${url}` }, 500)
}

const { default: ArticleBatchWorkspace } = await import("../src/components/article/article-batch-workspace")

const container = document.getElementById("root")!
const root = createRoot(container)
const validPayload = {
  promptKey: "thirdPartyObservation",
  modelProvider: "article",
  model: "deepseek-chat",
  clientName: "测试客户",
  brandName: "测试品牌",
  subjectType: "brand",
  subjectContext: "",
  industry: "测试行业",
  website: "",
  coreQuestion: "停止后需要继续批量生成",
  keywords: "",
  region: "",
  business: "",
  advantages: "",
  audience: "",
  extraRequirements: "",
}

function render(basePayload = validPayload) {
  root.render(React.createElement(ArticleBatchWorkspace, {
    clientId: "client_restart_test",
    promptTitle: "第三方检测",
    basePayload,
    keywordQuestions: [],
    perArticleCredits: 1,
  }))
}

async function waitFor(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    if (check()) return
  }
  throw new Error(message)
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")]
    .find(item => item.textContent?.includes(label)) as HTMLButtonElement | undefined
}

await act(async () => render())
await waitFor(() => Boolean(button("批量生成 10 篇")), "批量生成工作区未加载")

await act(async () => {
  button("批量生成 10 篇")!.click()
})
await waitFor(() => Boolean(button("停止剩余")), "批次创建后未显示停止按钮")

await act(async () => {
  button("停止剩余")!.click()
})
await waitFor(() => patchActions.includes("cancel"), "停止操作未发送")
await waitFor(() => !button("停止剩余"), "停止后批次未进入终态")

await act(async () => render({ ...validPayload, coreQuestion: "" }))
await waitFor(() => Boolean(button("按原设置重新生成")), "停止后没有提供按原设置重新生成入口")
assert.equal(button("按原设置重新生成")?.disabled, false)

await act(async () => {
  button("按原设置重新生成")!.click()
})
await waitFor(() => patchActions.includes("restart"), "重新生成没有创建独立新批次")
assert.equal(batches[0].id, "batch_restarted_2")

await act(async () => root.unmount())
console.log("article batch restart test passed")
