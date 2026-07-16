import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import type { ChatArgs } from "../src/lib/llm/openai-compat"
import type { ModelKey, PenetrationResult } from "../src/types"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-penetration-sampling-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.ARK_API_KEY = "test-ark-key"
process.env.ARK_DOUBAO_ENDPOINT_ID = "doubao-seed-2-0-lite-260215"

const { ADAPTERS } = await import("../src/lib/llm")
const { createInternalApiHeaders } = await import("../src/lib/internal-api")
const { POST } = await import("../src/app/api/penetration/route")
const { buildPenetrationBatchResult } = await import("../src/lib/penetration/result-merge")

const originalAdapters = { ...ADAPTERS }
const consumerCalls: ChatArgs[] = []

const disabledModels: ModelKey[] = ["qwen", "kimi", "ernie", "hunyuan"]
for (const model of disabledModels) {
  ADAPTERS[model] = {
    ...ADAPTERS[model],
    configured: async () => false,
  }
}

ADAPTERS.doubao = {
  label: "豆包",
  configured: async () => true,
  chat: async args => {
    consumerCalls.push(args)
    const callNumber = consumerCalls.length
    args.onSearchSources?.({
      query: args.user,
      sources: [{
        title: `独立来源 ${callNumber}`,
        snippet: `第 ${callNumber} 次独立联网请求`,
        url: `https://example.com/source-${callNumber}`,
        domain: "example.com",
        query: args.user,
      }],
      mode: "native_web",
      searchExecuted: true,
      providerRequestId: `provider-request-${callNumber}`,
    })
    return `第 ${callNumber} 次独立原始回答`
  },
}

ADAPTERS.deepseek = {
  label: "DeepSeek",
  configured: async () => true,
  chat: async args => {
    if (args.mode !== "judge") throw new Error("DeepSeek should only act as judge in this test")
    const entries = JSON.parse(args.user.match(/\[[\s\S]*\]/)?.[0] || "[]") as Array<{ id: string }>
    return JSON.stringify({
      items: entries.map(entry => ({
        id: entry.id,
        mentionedBrands: [],
        topRecommended: "",
      })),
    })
  },
}

async function runDetection(runId: string, questions: string[]): Promise<PenetrationResult> {
  const request = new NextRequest("http://localhost/api/penetration", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...createInternalApiHeaders("penetration-job"),
    },
    body: JSON.stringify({
      runId,
      sampleStart: 0,
      ourBrand: "测试品牌",
      brandAliases: [],
      industry: "测试行业",
      questions,
      competitors: [],
      models: ["doubao"],
    }),
  })
  const response = await POST(request)
  const data = await response.json() as PenetrationResult & { error?: string }
  assert.equal(response.status, 200, data.error)
  return data
}

try {
  const question = "同一个问题是否会重新联网回答？"
  const first = await runDetection("penetration_first_run_123456", [question, question])
  const firstItems = first.byModel.doubao || []

  assert.equal(consumerCalls.length, 2, "同批重复问题必须分别调用两次被测模型")
  assert.equal(firstItems.length, 2, "同批重复问题必须保留两份独立结果")
  assert.deepEqual(firstItems.map(item => item.answer), [
    "第 1 次独立原始回答",
    "第 2 次独立原始回答",
  ])
  assert.equal(firstItems[0].question, question)
  assert.equal(firstItems[1].question, question)
  assert.ok(firstItems[0].sampleId)
  assert.ok(firstItems[1].sampleId)
  assert.notEqual(firstItems[0].sampleId, firstItems[1].sampleId)
  assert.notEqual(consumerCalls[0].seed, consumerCalls[1].seed)
  assert.deepEqual(firstItems[0].providerRequestIds, ["provider-request-1"])
  assert.deepEqual(firstItems[1].providerRequestIds, ["provider-request-2"])
  assert.equal(consumerCalls.every(call => call.system === ""), true)
  assert.equal(consumerCalls.every(call => call.user === question), true)
  assert.equal(consumerCalls.every(call => call.rawQuestionOnly === true), true)
  assert.equal(consumerCalls.every(call => call.forceWebSearch === true), true)

  const second = await runDetection("penetration_second_run_123456", [question])
  const secondItem = second.byModel.doubao?.[0]
  assert.equal(consumerCalls.length, 3, "新的用户操作必须重新调用模型")
  assert.ok(secondItem?.sampleId)
  assert.notEqual(secondItem?.sampleId, firstItems[0].sampleId)
  assert.notEqual(consumerCalls[2].seed, consumerCalls[0].seed)
  assert.deepEqual(secondItem?.providerRequestIds, ["provider-request-3"])

  const appended = buildPenetrationBatchResult({
    operation: "append",
    currentResult: undefined,
    baseResult: first,
    incomingByModel: second.byModel,
    ourBrand: "测试品牌",
    brandAliases: [],
    competitors: [],
    generatedAt: second.generatedAt,
  })
  assert.equal(appended.byModel.doubao?.length, 3, "单题重测必须追加结果，不能覆盖原报告")
  assert.deepEqual(appended.byModel.doubao?.map(item => item.answer), [
    "第 1 次独立原始回答",
    "第 2 次独立原始回答",
    "第 3 次独立原始回答",
  ])
  assert.equal(appended.aggregated.totalSlots, 3, "追加样本必须参与统计")

  console.log("Penetration independent sampling contract passed.")
} finally {
  Object.assign(ADAPTERS, originalAdapters)
  fs.rmSync(tempDir, { recursive: true, force: true })
}
