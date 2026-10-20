export async function register() {
  // Keep Node-only imports inside the branch so the Edge compiler prunes them.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const recoveries: Array<[string, () => Promise<unknown>]> = [
      ["local-publishing", async () => (await import("@/lib/local-publishing/service")).startLocalPublishing()],
      ["penetration", async () => (await import("@/lib/penetration/jobs")).resumePendingPenetrationJobs()],
      ["difficulty", async () => (await import("@/lib/difficulty/jobs")).resumePendingDifficultyJobs()],
      ["background", async () => (await import("@/lib/background-jobs")).resumePendingBackgroundJobs()],
      ["questions", async () => (await import("@/lib/geo-strategy/question-jobs")).resumePendingQuestionJobs()],
    ]
    // Recover each job type independently: one failing store (for example a
    // transient Redis error at boot) must not abort the others or the server.
    const results = await Promise.allSettled(recoveries.map(([, recover]) => recover()))
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(`[instrumentation] failed to resume ${recoveries[index][0]} jobs`, result.reason)
      }
    })
  }
}
