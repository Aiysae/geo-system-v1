import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Client, PenetrationItem } from "../src/types"

// A share link shows the report as it was when made, needs no sign-in, and
// stops working the moment it is turned off.

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-penetration-share-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")

const { buildPenetrationBatchResult } = await import("../src/lib/penetration/result-merge")
const {
  createPenetrationShare,
  getPenetrationShare,
  listPenetrationShares,
  revokePenetrationShare,
} = await import("../src/lib/penetration/share-store")

function item(index: number, brand: string): PenetrationItem {
  return {
    sampleId: `share_kimi_${index}`,
    sampledAt: "2026-10-23T00:00:00.000Z",
    question: `问题${index}`,
    answer: `推荐${brand}和测试品牌。`,
    mentionedBrands: [brand, "测试品牌"],
    topRecommended: brand,
    searchSources: [{ title: "来源", snippet: "很长的摘要".repeat(40), url: `https://example.com/${index}`, domain: "example.com", query: "监理" }],
    sourceCount: 1,
    searchMode: "native_web",
    promptPurity: "raw_question_only",
    requestAuditVerified: true,
    webAttempted: true,
    webExecutionVerified: true,
    providerRequestIds: [`request-${index}`],
    webVerified: true,
    extraction: { status: "succeeded", attempts: 1, version: 2 },
    hitOur: true,
  }
}

try {
  const penetration = buildPenetrationBatchResult({
    operation: "replace",
    incomingByModel: { kimi: [item(1, "甲公司"), item(2, "乙公司")] },
    ourBrand: "测试品牌",
    brandAliases: [],
    competitors: [],
    subjectType: "brand",
    generatedAt: "2026-10-23T00:00:00.000Z",
  })
  const client = {
    id: "share-client",
    name: "分享客户",
    subjectType: "brand",
    ourBrand: "测试品牌",
    brandAliases: [],
    industry: "工程监理",
    website: "",
    questions: ["问题1", "问题2"],
    competitors: [],
    selectedModels: ["kimi"],
    createdAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
    penetration,
  } as Client

  const share = await createPenetrationShare({ ownerUserId: "owner", createdByUserId: "member", client })
  assert.match(share.token, /^[A-Za-z0-9_-]{32}$/)
  assert.equal(share.sharePath, `/penetration/share/${share.token}`)
  const snapshot = await getPenetrationShare(share.token)
  assert.equal(snapshot?.ourBrand, "测试品牌")
  assert.equal(snapshot?.penetration.aggregated.ourMentions, 2, "figures are recomputed for the page")
  const shared = snapshot!.penetration.byModel.kimi![0]
  assert.equal(shared.searchSources![0].snippet, "", "snippets the page never shows are left out")
  assert.equal(shared.searchSources![0].url, "https://example.com/1")
  assert.equal(shared.providerRequestIds, undefined)
  assert.equal(shared.answer, "推荐甲公司和测试品牌。", "the raw answers are kept")

  // Later runs leave the shared copy alone.
  client.penetration = { ...penetration, generatedAt: "2026-10-24T00:00:00.000Z", byModel: {} }
  assert.equal((await getPenetrationShare(share.token))?.penetration.generatedAt, "2026-10-23T00:00:00.000Z")

  const second = await createPenetrationShare({ ownerUserId: "owner", createdByUserId: "member", client: { ...client, penetration } })
  assert.deepEqual((await listPenetrationShares("owner", "share-client")).map(entry => entry.token).sort(), [share.token, second.token].sort())
  assert.deepEqual(await listPenetrationShares("someone-else", "share-client"), [])

  assert.equal(await revokePenetrationShare({ ownerUserId: "someone-else", clientId: "share-client", token: share.token }), false)
  assert.equal(await revokePenetrationShare({ ownerUserId: "owner", clientId: "share-client", token: share.token }), true)
  assert.equal(await getPenetrationShare(share.token), null, "a turned-off link stops working")
  assert.deepEqual((await listPenetrationShares("owner", "share-client")).map(entry => entry.token), [second.token])
  assert.equal(await getPenetrationShare("../../etc/passwd"), null)

  await assert.rejects(createPenetrationShare({ ownerUserId: "owner", createdByUserId: "member", client: { ...client, penetration: undefined } }), /还没有检测结果/)

  console.log("Penetration share links: frozen snapshot, listing and turning off passed.")
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}
