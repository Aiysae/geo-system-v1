const store = await import("../src/lib/publishing-plan/store")

await store.ensurePublishingPlanSchema()
await store.closePublishingPlanStoreConnection()
console.log("Publishing plan database schema is ready")
