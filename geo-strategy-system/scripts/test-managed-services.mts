import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const kvFile = path.join(os.tmpdir(), `geo-managed-services-kv-${process.pid}.json`)
const workspaceFile = path.join(os.tmpdir(), `geo-managed-services-workspaces-${process.pid}.json`)
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = kvFile
process.env.PAYMENT_STORE = "kv"
process.env.WORKSPACE_STORE = "file"
process.env.WORKSPACE_FILE = workspaceFile
process.env.CREDITS_INITIAL = "50"
process.env.MANAGED_SERVICE_OWNER_USER_ID = "managed-admin-owner"

const { MANAGED_SERVICE_PLANS } = await import("../src/lib/managed-service-plans")
const {
  createManagedServiceOrder,
  getManagedServiceOrder,
  linkManagedServicePayment,
  listManagedServiceOrdersForUser,
  submitManagedServiceIntake,
} = await import("../src/lib/managed-services")
const { createPaymentOrder, creditPaymentOrder } = await import("../src/lib/payment-orders")
const { getCredits } = await import("../src/lib/credits")
const { getMembership } = await import("../src/lib/membership")
const { listWorkspaceClients } = await import("../src/lib/workspace-store")
const { mergeBillingRechargeRecords } = await import("../src/lib/billing-records")
const { getFirstPurchaseBlockReason } = await import("../src/lib/payment-lifecycle")
const { getManagedServiceNotificationSnapshot } = await import("../src/lib/managed-service-notifications")

try {
  const plan = MANAGED_SERVICE_PLANS[0]
  const serviceOrder = await createManagedServiceOrder({
    userId: "managed-buyer",
    username: "代运营客户",
    email: "managed@example.com",
    ownerUserId: "managed-admin-owner",
    plan,
    provider: "wechat",
  })
  const payment = await createPaymentOrder({
    userId: "managed-buyer",
    username: "代运营客户",
    email: "managed@example.com",
    productType: "managed_service",
    managedServiceOrderId: serviceOrder.id,
    packageName: plan.name,
    priceCents: plan.priceCents,
    credits: 0,
    provider: "wechat",
  })
  await linkManagedServicePayment(serviceOrder.id, payment)

  const results = await Promise.all(Array.from({ length: 8 }, () => creditPaymentOrder({
    orderId: payment.id,
    providerTradeId: "managed-test-trade",
    paidCents: plan.priceCents,
    source: "payment_callback",
  })))
  assert.equal(results.filter(result => result.ok && result.credited).length, 1)
  assert.equal(await getCredits("managed-buyer"), 50, "managed service payments must not grant credits")
  assert.equal((await getMembership("managed-buyer")).tier, "free", "managed service payments must not upgrade VIP")
  assert.equal(getFirstPurchaseBlockReason([payment], "trial_990"), null)
  assert.equal(mergeBillingRechargeRecords([], [{ ...payment, status: "credited" }]).length, 0)

  const buyerOrders = await listManagedServiceOrdersForUser("managed-buyer")
  assert.equal(buyerOrders.length, 1)
  assert.equal(buyerOrders[0]?.status, "awaiting_intake")
  const ownerClients = await listWorkspaceClients("managed-admin-owner")
  assert.equal(ownerClients.length, 1, "repeated callbacks must create exactly one owner project")

  const updated = await submitManagedServiceIntake(serviceOrder.id, {
    subjectType: "brand",
    subjectName: "测试品牌",
    projectName: "测试品牌 GEO 运营",
    aliases: "测试牌,Test Brand",
    industry: "企业服务",
    region: "全国",
    website: "https://example.com",
    advantages: "公开可验证的产品能力",
    contactName: "张先生",
  })
  assert.equal(updated.status, "intake_submitted")
  assert.equal((await getManagedServiceOrder(serviceOrder.id))?.intake?.subjectName, "测试品牌")
  const renamedClients = await listWorkspaceClients("managed-admin-owner")
  assert.equal(renamedClients[0]?.client.name, "测试品牌 GEO 运营")
  assert.equal((await getManagedServiceNotificationSnapshot("admin-reader")).unread.length, 2)

  console.log("Managed service payment and fulfillment contract passed")
} finally {
  await fs.rm(kvFile, { force: true })
  await fs.rm(workspaceFile, { force: true })
}
