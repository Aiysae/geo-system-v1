import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const testDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-onboarding-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(testDirectory, "kv.json")
process.env.ONBOARDING_AUTOLAUNCH_AFTER = "2026-07-23T00:00:00+08:00"

const {
  getOnboardingState,
  shouldAutoLaunchOnboarding,
  updateOnboardingState,
} = await import("../src/lib/onboarding")
const { TUTORIAL_DEMOS } = await import("../src/lib/tutorial-data")

const userId = "onboarding-test-user"

try {
  const initial = await getOnboardingState(userId)
  assert.equal(initial.status, "not_started")
  assert.equal(initial.currentStep, 0)
  assert.equal(initial.subjectType, "brand")

  assert.equal(shouldAutoLaunchOnboarding({
    userCreatedAt: "2026-07-23T08:00:00+08:00",
    state: initial,
  }), true)
  assert.equal(shouldAutoLaunchOnboarding({
    userCreatedAt: "2026-07-22T23:59:59+08:00",
    state: initial,
  }), false)

  const started = await updateOnboardingState({
    userId,
    action: "start",
    subjectType: "person",
  })
  assert.equal(started.status, "in_progress")
  assert.equal(started.subjectType, "person")
  assert.ok(started.startedAt)

  const clamped = await updateOnboardingState({
    userId,
    action: "progress",
    currentStep: 99,
    subjectType: "person",
  })
  assert.equal(clamped.currentStep, 7)

  const completed = await updateOnboardingState({
    userId,
    action: "complete",
    subjectType: "person",
  })
  assert.equal(completed.status, "completed")
  assert.equal(completed.currentStep, 7)
  assert.equal(shouldAutoLaunchOnboarding({
    userCreatedAt: "2026-07-23T08:00:00+08:00",
    state: completed,
  }), false)

  const replayProgress = await updateOnboardingState({
    userId,
    action: "progress",
    currentStep: 2,
    subjectType: "brand",
  })
  assert.equal(replayProgress.status, "completed")
  assert.equal(replayProgress.currentStep, 7)
  assert.equal(replayProgress.subjectType, "person")

  const reset = await updateOnboardingState({
    userId,
    action: "reset",
    subjectType: "brand",
  })
  assert.equal(reset.status, "in_progress")
  assert.equal(reset.currentStep, 0)
  assert.equal(reset.subjectType, "brand")

  const dismissed = await updateOnboardingState({
    userId,
    action: "dismiss",
    currentStep: 3,
    subjectType: "brand",
  })
  assert.equal(dismissed.status, "dismissed")
  assert.equal(shouldAutoLaunchOnboarding({
    userCreatedAt: "2026-07-23T08:00:00+08:00",
    state: dismissed,
  }), false)

  for (const subjectType of ["brand", "person"] as const) {
    const demo = TUTORIAL_DEMOS[subjectType]
    assert.equal(demo.questions.length, 7)
    assert.equal(new Set(demo.questions.map(item => item.id)).size, 7)
    assert.equal(demo.strategy.length, 7)
    assert.equal(demo.difficulty.dimensions.length, 7)
    assert.ok(demo.penetration.perModelRate.length >= 4)
    assert.ok(demo.article.files.length >= 3)
  }

  const tutorialSource = await fs.readFile(
    path.join(process.cwd(), "src/components/tutorial/interactive-tutorial.tsx"),
    "utf8",
  )
  const forbiddenLiveEndpoints = [
    "/api/penetration",
    "/api/diagnose",
    "/api/research",
    "/api/difficulty-assessment",
    "/api/geo-strategy",
    "/api/article-generation",
    "/api/generate",
  ]
  for (const endpoint of forbiddenLiveEndpoints) {
    assert.equal(
      tutorialSource.includes(endpoint),
      false,
      `tutorial must not call live endpoint ${endpoint}`,
    )
  }
  assert.equal(tutorialSource.includes("/api/onboarding"), true)

  console.log("onboarding tests passed")
} finally {
  await fs.rm(testDirectory, { recursive: true, force: true })
}
