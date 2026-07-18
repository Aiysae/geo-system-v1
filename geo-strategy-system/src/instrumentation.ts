export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { resumePendingPenetrationJobs } = await import("@/lib/penetration/jobs")
  await resumePendingPenetrationJobs()
}
