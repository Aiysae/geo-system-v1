const store = await import("../src/lib/content-production/store")

await store.ensureContentProductionSchema()
await store.closeContentProductionStoreConnection()
console.log("Content production database schema is ready")
