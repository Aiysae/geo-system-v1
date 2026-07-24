export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const [
    { resumePendingPenetrationJobs },
    { resumePendingDifficultyJobs },
    { resumePendingBackgroundJobs },
    { resumePendingQuestionJobs },
  ] = await Promise.all([
    import("@/lib/penetration/jobs"),
    import("@/lib/difficulty/jobs"),
    import("@/lib/background-jobs"),
    import("@/lib/geo-strategy/question-jobs"),
  ])
  await Promise.all([
    resumePendingPenetrationJobs(),
    resumePendingDifficultyJobs(),
    resumePendingBackgroundJobs(),
    resumePendingQuestionJobs(),
  ])
}
