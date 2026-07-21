import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Client } from "../src/types"

const testDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-client-account-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(testDirectory, "kv.json")
process.env.WORKSPACE_STORE = "file"
process.env.WORKSPACE_FILE = path.join(testDirectory, "workspace.json")
process.env.CREDITS_INITIAL = "50"

const {
  canRunBillableFeature,
  deleteClientAccountLink,
  getWorkspaceAccountAccess,
  listClientAccountAudit,
  resolveWorkspaceAccess,
  saveClientAccountLink,
  setClientAccountStatus,
} = await import("../src/lib/client-accounts")
const {
  getCreditBalanceSnapshot,
  initializeManagedAccountCredits,
  refundCreditReservationBreakdown,
  reserveCreditsBy,
  syncClientMonthlyAllowance,
} = await import("../src/lib/credits")
const { settleReservedCredits } = await import("../src/lib/with-credits")
const { transferCreditsToManagedAccount } = await import("../src/lib/client-credit-transfer")
const {
  createWorkspaceClient,
  listWorkspaceClients,
} = await import("../src/lib/workspace-store")

const ownerUserId = "client-owner-user"
const clientUserId = "dedicated-client-user"
const operatorUserId = "admin-user"
const now = new Date().toISOString()
const client: Client = {
  id: "client-account-contract",
  name: "专属客户测试品牌",
  subjectType: "brand",
  ourBrand: "测试品牌",
  brandAliases: ["TEST"],
  industry: "测试行业",
  website: "https://example.com",
  questions: ["测试问题"],
  competitors: ["测试竞品"],
  selectedModels: ["qwen"],
  createdAt: now,
  updatedAt: now,
}

try {
  await createWorkspaceClient(ownerUserId, client)
  const link = await saveClientAccountLink({
    userId: clientUserId,
    ownerUserId,
    clientId: client.id,
    clientName: client.name,
    monthlyCredits: 1000,
    operatorUserId,
  })
  assert.equal(link.status, "active")
  assert.equal(link.provisioning, "admin")
  assert.equal(link.billingMode, "monthly_grant")

  const access = await getWorkspaceAccountAccess(clientUserId)
  assert.equal(access.mode, "client")
  assert.equal(access.clientId, client.id)
  assert.equal(access.canCreateClients, false)
  assert.equal(access.canManageClientIdentity, false)
  assert.equal(access.canRunPenetration, true)
  assert.equal(access.canRunOtherModules, false)
  assert.equal(access.canCreateReports, false)
  assert.equal(access.canViewFeedbackReports, true)
  assert.equal(access.canManageFeedbackReports, false)

  const allowedScope = await resolveWorkspaceAccess(clientUserId, client.id)
  assert.equal(allowedScope.ok, true)
  assert.equal(allowedScope.ok && allowedScope.ownerUserId, ownerUserId)
  const deniedScope = await resolveWorkspaceAccess(clientUserId, "different-client")
  assert.equal(deniedScope.ok, false)
  assert.equal(!deniedScope.ok && deniedScope.code, "CLIENT_ACCESS_DENIED")

  assert.equal((await canRunBillableFeature(clientUserId, "penetrationSlot")).ok, true)
  const articleAccess = await canRunBillableFeature(clientUserId, "articleGenerate")
  assert.equal(articleAccess.ok, false)

  const initial = await getCreditBalanceSnapshot(clientUserId)
  assert.deepEqual(
    {
      total: initial.total,
      permanent: initial.permanent,
      monthly: initial.monthly,
      monthlyAllowance: initial.monthlyAllowance,
    },
    { total: 1050, permanent: 50, monthly: 1000, monthlyAllowance: 1000 },
  )

  const reserved = await reserveCreditsBy(clientUserId, 1020, {
    featureKey: "penetrationSlot",
    source: "test:client-account",
  })
  assert.equal(reserved.ok, true)
  if (!reserved.ok) throw new Error("reservation unexpectedly failed")
  assert.equal(reserved.monthlyReserved, 1000)
  assert.equal(reserved.permanentReserved, 20)
  assert.equal(reserved.monthlyBalance, 0)
  assert.equal(reserved.permanentBalance, 30)
  assert.equal(reserved.balance, 30)

  await refundCreditReservationBreakdown({
    userId: clientUserId,
    permanentCredits: reserved.permanentReserved,
    monthlyCredits: reserved.monthlyReserved,
    monthlyPeriod: reserved.monthlyPeriod,
    context: {
      type: "usage_refund",
      source: "test:client-account",
    },
  })
  assert.equal((await getCreditBalanceSnapshot(clientUserId)).total, 1050)

  const monthlyOnly = await reserveCreditsBy(clientUserId, 80, {
    featureKey: "penetrationSlot",
    source: "test:client-account",
  })
  assert.equal(monthlyOnly.ok, true)
  if (!monthlyOnly.ok) throw new Error("monthly reservation unexpectedly failed")
  assert.equal(monthlyOnly.monthlyReserved, 80)
  assert.equal(monthlyOnly.permanentReserved, 0)
  assert.equal((await getCreditBalanceSnapshot(clientUserId)).monthly, 920)
  await settleReservedCredits({
    userId: clientUserId,
    amount: 80,
    balanceAfterReserve: monthlyOnly.balance,
    permanentReserved: monthlyOnly.permanentReserved,
    monthlyReserved: monthlyOnly.monthlyReserved,
    monthlyPeriod: monthlyOnly.monthlyPeriod,
    ledgerContext: {
      featureKey: "penetrationSlot",
      source: "test:client-account",
    },
  }, 30)
  assert.equal(
    (await getCreditBalanceSnapshot(clientUserId)).monthly,
    970,
    "unused monthly reservation must return to the monthly bucket",
  )

  await setClientAccountStatus({
    userId: clientUserId,
    status: "suspended",
    operatorUserId,
  })
  const suspended = await resolveWorkspaceAccess(clientUserId, client.id)
  assert.equal(suspended.ok, false)
  assert.equal(!suspended.ok && suspended.code, "CLIENT_ACCOUNT_SUSPENDED")
  assert.equal((await getCreditBalanceSnapshot(clientUserId)).total, 50)

  await setClientAccountStatus({
    userId: clientUserId,
    status: "active",
    operatorUserId,
  })
  assert.equal((await getCreditBalanceSnapshot(clientUserId)).monthly, 970)

  const adjusted = await syncClientMonthlyAllowance({
    userId: clientUserId,
    amount: 1200,
    operatorUserId,
    previousAllowance: 1000,
  })
  assert.equal(adjusted.monthly, 1170)
  assert.equal(adjusted.total, 1220)

  const repeatedSave = await syncClientMonthlyAllowance({
    userId: clientUserId,
    amount: 1200,
    operatorUserId,
    previousAllowance: 1200,
  })
  assert.equal(repeatedSave.monthly, 1170, "re-saving access must not refill used monthly credits")

  const ownerClients = await listWorkspaceClients(ownerUserId)
  const dedicatedOwnClients = await listWorkspaceClients(clientUserId)
  assert.equal(ownerClients.length, 1)
  assert.equal(dedicatedOwnClients.length, 0)

  const audit = await listClientAccountAudit(clientUserId)
  assert.deepEqual(
    audit.map(entry => entry.action).sort(),
    ["activated", "linked", "suspended"].sort(),
  )

  const managedChildUserId = "owner-created-managed-child"
  await saveClientAccountLink({
    userId: managedChildUserId,
    ownerUserId,
    clientId: "owner-managed-client",
    clientName: "主账号自建客户",
    monthlyCredits: 0,
    provisioning: "owner",
    billingMode: "self_funded",
    operatorUserId: ownerUserId,
  })
  await initializeManagedAccountCredits(managedChildUserId)
  assert.equal((await getCreditBalanceSnapshot(managedChildUserId)).total, 0)
  const firstTransfer = await transferCreditsToManagedAccount({
    operationId: "ct_client_account_transfer_001",
    ownerUserId,
    childUserId: managedChildUserId,
    amount: 20,
  })
  assert.equal(firstTransfer.status, "completed")
  assert.equal((await getCreditBalanceSnapshot(ownerUserId)).total, 30)
  assert.equal((await getCreditBalanceSnapshot(managedChildUserId)).total, 20)
  const repeatedTransfer = await transferCreditsToManagedAccount({
    operationId: "ct_client_account_transfer_001",
    ownerUserId,
    childUserId: managedChildUserId,
    amount: 20,
  })
  assert.equal(repeatedTransfer.status, "completed")
  assert.equal((await getCreditBalanceSnapshot(ownerUserId)).total, 30, "transfer retry must not debit twice")
  assert.equal((await getCreditBalanceSnapshot(managedChildUserId)).total, 20, "transfer retry must not credit twice")

  assert.equal(await deleteClientAccountLink({ userId: managedChildUserId, operatorUserId: ownerUserId }), true)
  assert.equal(await deleteClientAccountLink({ userId: clientUserId, operatorUserId }), true)
  assert.equal((await getWorkspaceAccountAccess(clientUserId)).mode, "standard")
  assert.equal((await getCreditBalanceSnapshot(clientUserId)).total, 50)

  console.log("Client account access, canonical workspace and monthly credit contract passed")
} finally {
  await fs.rm(testDirectory, { recursive: true, force: true })
}
