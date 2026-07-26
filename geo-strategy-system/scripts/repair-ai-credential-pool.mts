import type { AiCredentialPublic } from "../src/types/ai-credentials"

const apply = process.argv.includes("--apply")
const {
  closeAiCredentialStoreConnection,
  listAiCredentialsPublic,
  saveAiCredential,
} = await import("../src/lib/ai-credential-store")
const { closeKvConnection } = await import("../src/lib/kv")
const { knownAiCredentialRepair } = await import(
  "../src/lib/ai-credential-pool-repair"
)

function changedValues(
  credential: AiCredentialPublic,
  patch: ReturnType<typeof knownAiCredentialRepair>,
): Record<string, unknown> {
  if (!patch) return {}
  const changed: Record<string, unknown> = {}
  if (patch.baseUrl && patch.baseUrl !== credential.baseUrl) {
    changed.baseUrl = patch.baseUrl
  }
  if (patch.chatPath && patch.chatPath !== credential.chatPath) {
    changed.chatPath = patch.chatPath
  }
  if (
    patch.allowedModels
    && JSON.stringify(patch.allowedModels) !== JSON.stringify(credential.allowedModels)
  ) {
    changed.allowedModels = patch.allowedModels
  }
  if (patch.priority && patch.priority !== credential.priority) {
    changed.priority = patch.priority
  }
  return changed
}

try {
  const credentials = await listAiCredentialsPublic()
  let repaired = 0
  for (const credential of credentials) {
    const patch = knownAiCredentialRepair(credential)
    const changes = changedValues(credential, patch)
    if (!patch || Object.keys(changes).length === 0) continue

    console.log(JSON.stringify({
      mode: apply ? "apply" : "preview",
      vendor: credential.vendor,
      account: credential.accountLabel,
      reason: patch.reason,
      changes,
    }))
    if (!apply) continue

    await saveAiCredential({
      id: credential.id,
      vendor: credential.vendor,
      name: credential.name,
      accountLabel: credential.accountLabel,
      quotaGroup: credential.quotaGroup,
      baseUrl: patch.baseUrl || credential.baseUrl,
      chatPath: patch.chatPath || credential.chatPath,
      enabled: credential.enabled,
      priority: patch.priority || credential.priority,
      weight: credential.weight,
      maxConcurrency: credential.maxConcurrency,
      quotaGroupMaxConcurrency: credential.quotaGroupMaxConcurrency,
      rpmLimit: credential.rpmLimit,
      tpmLimit: credential.tpmLimit,
      dailyBudgetCents: credential.dailyBudgetCents,
      allowedModels: patch.allowedModels || credential.allowedModels,
      allowedModules: credential.allowedModules,
      declaredCapabilities: credential.declaredCapabilities,
    }, "credential-pool-repair")
    repaired += 1
  }
  console.log(JSON.stringify({
    mode: apply ? "apply" : "preview",
    repaired,
    message: apply
      ? "配置修复完成；请继续执行账号能力检测后再启用。"
      : "预览完成；加上 --apply 才会应用，API Key 和启用状态不会改变。",
  }))
} finally {
  await Promise.allSettled([
    closeAiCredentialStoreConnection(),
    closeKvConnection(),
  ])
}
