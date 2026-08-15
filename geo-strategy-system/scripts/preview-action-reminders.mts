const feedbackImport = await import("../src/lib/client-feedback/store")
const feedbackStore = (
  "default" in feedbackImport ? feedbackImport.default : feedbackImport
) as typeof import("../src/lib/client-feedback/store")
const reminderImport = await import("../src/lib/action-reminders/service")
const reminderService = (
  "default" in reminderImport ? reminderImport.default : reminderImport
) as typeof import("../src/lib/action-reminders/service")
const kvImport = await import("../src/lib/kv")
const kvStore = (
  "default" in kvImport ? kvImport.default : kvImport
) as typeof import("../src/lib/kv")
const teamImport = await import("../src/lib/team-store")
const teamStore = (
  "default" in teamImport ? teamImport.default : teamImport
) as typeof import("../src/lib/team-store")

const { shanghaiDateOnly } = feedbackStore
const {
  buildActionReminderCandidate,
  listEligibleActionReminderRecipientIds,
} = reminderService
const { closeKvConnection } = kvStore
const { closeTeamStoreConnection } = teamStore

const date = String(process.argv[2] || shanghaiDateOnly()).trim()
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  throw new Error("日期格式必须为 YYYY-MM-DD")
}

try {
  const recipientIds = await listEligibleActionReminderRecipientIds()
  const candidates: Awaited<ReturnType<typeof buildActionReminderCandidate>>[] = []
  for (let index = 0; index < recipientIds.length; index += 25) {
    const chunk = recipientIds.slice(index, index + 25)
    candidates.push(...await Promise.all(
      chunk.map(userId => buildActionReminderCandidate(userId, date)),
    ))
  }

  const activeCandidates = candidates.filter(
    (candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate),
  )
  const missingClients = activeCandidates.flatMap(candidate => candidate.missingClients)
  const uniqueClientKeys = new Set(missingClients.map(client => (
    `${client.dataOwnerUserId}\u0000${client.clientId}`
  )))

  console.log(JSON.stringify({
    date,
    eligibleRecipientCount: recipientIds.length,
    reminderRecipientCount: activeCandidates.filter(candidate => candidate.missingClients.length > 0).length,
    noMissingActionRecipientCount: activeCandidates.filter(candidate => candidate.missingClients.length === 0).length,
    unavailableRecipientCount: candidates.filter(candidate => !candidate).length,
    uniqueMissingClientCount: uniqueClientKeys.size,
    recipientClientAssignmentCount: missingClients.length,
    editableAssignmentCount: missingClients.filter(client => client.canEdit).length,
    viewOnlyAssignmentCount: missingClients.filter(client => !client.canEdit).length,
    teamAssignmentCount: missingClients.filter(client => client.accessMode === "team").length,
    generatedAt: new Date().toISOString(),
    mode: "read-only",
  }, null, 2))
} finally {
  await Promise.allSettled([
    closeTeamStoreConnection(),
    closeKvConnection(),
  ])
}
