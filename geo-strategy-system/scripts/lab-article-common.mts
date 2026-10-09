// Shared setup for paid article-quality lab runs. Not part of `npm test`.
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export function loadLabEnv(): string {
  const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/)
    .map(line => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map(match => [match![1], match![2].replace(/^["']|["']$/g, "")]))
  const dir = mkdtempSync(join(tmpdir(), "geo-article-lab-"))
  // Keep every store local and temporary; never touch remote KV, Redis or Postgres.
  for (const name of ["DATABASE_URL", "REDIS_URL", "KV_URL", "KV_REST_API_URL", "KV_REST_API_TOKEN", "KV_REST_API_READ_ONLY_TOKEN"]) delete process.env[name]
  process.env.KV_BACKEND = "file"
  process.env.LOCAL_KV_FILE = join(dir, "kv.json")
  process.env.SYSTEM_OUTPUT_FILE = join(dir, "outputs.json")
  process.env.AI_CONFIG_ENCRYPTION_KEY = "article-lab-local-key"
  process.env.ARK_API_KEY = env.ARK_API_KEY
  process.env.DASHSCOPE_API_KEY = env.DASHSCOPE_API_KEY
  process.env.DASHSCOPE_MODEL = "qwen-plus"
  process.env.ARTICLE_AUXILIARY_MODEL_PROVIDER = "qwen"
  process.env.ARTICLE_AUXILIARY_MODEL = "qwen-plus"
  return dir
}

export const LAB_SUBJECT = {
  promptKey: "selectionPitfallGuide" as const,
  clientName: "合成验收甲",
  brandName: "合成验收甲",
  industry: "企业内容服务",
  region: "国内",
  business: "内容资料整理、方案编写和交付支持",
  advantages: "可提供服务范围清单、实施计划、交付记录和验收清单，供采购方在签约前核对。",
  audience: "准备采购企业内容服务的采购负责人和业务负责人",
  extraRequirements: "约 1200-1800 字。资料不含价格、排名或案例证据，不得补造。",
}
