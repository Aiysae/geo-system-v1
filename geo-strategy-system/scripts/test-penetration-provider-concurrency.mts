import assert from "node:assert/strict"

const concurrencyModule = await import("../src/lib/penetration/provider-concurrency")
const { PenetrationConcurrencyController } = concurrencyModule

const controller = new PenetrationConcurrencyController({
  total: 2,
  judge: 1,
  providers: {
    doubao: 1,
    deepseek: 2,
    qwen: 2,
    kimi: 1,
    ernie: 1,
    hunyuan: 1,
  },
})

let activeTotal = 0
let maxActiveTotal = 0
const activeByProvider = new Map<string, number>()
const maxByProvider = new Map<string, number>()
let activeJudges = 0
let maxActiveJudges = 0

async function trackedTask(provider: string, judge = false): Promise<void> {
  activeTotal++
  maxActiveTotal = Math.max(maxActiveTotal, activeTotal)
  const providerActive = (activeByProvider.get(provider) || 0) + 1
  activeByProvider.set(provider, providerActive)
  maxByProvider.set(provider, Math.max(maxByProvider.get(provider) || 0, providerActive))
  if (judge) {
    activeJudges++
    maxActiveJudges = Math.max(maxActiveJudges, activeJudges)
  }

  await new Promise(resolve => setTimeout(resolve, 40))

  if (judge) activeJudges--
  activeByProvider.set(provider, (activeByProvider.get(provider) || 1) - 1)
  activeTotal--
}

await Promise.all([
  ...Array.from({ length: 3 }, () =>
    controller.run("doubao", "consumer", () => trackedTask("doubao"))),
  ...Array.from({ length: 3 }, () =>
    controller.run("qwen", "consumer", () => trackedTask("qwen"))),
])

await Promise.all(
  Array.from({ length: 3 }, () =>
    controller.run("deepseek", "judge", () => trackedTask("deepseek", true))),
)

assert.equal(maxActiveTotal, 2, "所有疑问句外部模型请求必须受全局并发限制")
assert.equal(maxByProvider.get("doubao"), 1, "豆包必须遵守单独的供应商并发限制")
assert.equal(maxByProvider.get("qwen"), 2, "千问可以使用配置的两个并发位")
assert.equal(maxActiveJudges, 1, "AI 裁判必须使用独立并发池")
assert.deepEqual(controller.snapshot(), {
  total: { active: 0, waiting: 0, limit: 2 },
  judge: { active: 0, waiting: 0, limit: 1 },
  providers: {
    doubao: { active: 0, waiting: 0, limit: 1 },
    deepseek: { active: 0, waiting: 0, limit: 2 },
    qwen: { active: 0, waiting: 0, limit: 2 },
    kimi: { active: 0, waiting: 0, limit: 1 },
    ernie: { active: 0, waiting: 0, limit: 1 },
    hunyuan: { active: 0, waiting: 0, limit: 1 },
  },
})

console.log("Penetration provider concurrency gates passed.")
