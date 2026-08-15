import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-action-reminders-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(directory, "kv.json")
process.env.PAYMENT_STORE = "kv"
process.env.TEAM_STORE = "file"
process.env.TEAM_FILE = path.join(directory, "teams.json")
delete process.env.DATABASE_URL

const { createUser } = await import("../src/lib/auth")
const {
  saveClientAccountLink,
  setClientAccountStatus,
} = await import("../src/lib/client-accounts")
const {
  deleteClientExecutionAction,
  hasClientExecutionActionOnDate,
  saveClientExecutionAction,
} = await import("../src/lib/client-feedback/store")
const {
  buildActionReminderCandidate,
  dispatchActionReminderForRecipient,
  getActionReminderSettings,
  listEligibleActionReminderRecipientIds,
  saveActionReminderSettings,
} = await import("../src/lib/action-reminders/service")
const { buildActionReminderEmail } = await import("../src/lib/action-reminders/email")
const { actionReminderSchedule } = await import("../src/lib/action-reminders/scheduler")
const { getUserNotificationSnapshot } = await import("../src/lib/user-notifications")
const {
  createTeam,
  deleteTeamClientShare,
  saveTeamClientShare,
  saveTeamMember,
} = await import("../src/lib/team-store")

const reminderDate = "2026-08-08"

try {
  const owner = await createUser({
    email: "reminder-owner@example.com",
    password: "Reminder123",
    name: "提醒测试主账号",
    emailVerifiedAt: "2026-08-01T00:00:00.000Z",
  })
  const child = await createUser({
    email: "reminder-child@example.com",
    password: "Reminder123",
    name: "提醒测试子账号",
    emailVerifiedAt: "2026-08-01T00:00:00.000Z",
    managedByUserId: owner.id,
  })
  const editMember = await createUser({
    email: "reminder-editor@example.com",
    password: "Reminder123",
    name: "执行反馈编辑成员",
    emailVerifiedAt: "2026-08-01T00:00:00.000Z",
  })
  const viewMember = await createUser({
    email: "reminder-viewer@example.com",
    password: "Reminder123",
    name: "执行反馈只读成员",
    emailVerifiedAt: "2026-08-01T00:00:00.000Z",
  })
  const unrelatedMember = await createUser({
    email: "reminder-unrelated@example.com",
    password: "Reminder123",
    name: "无执行反馈权限成员",
    emailVerifiedAt: "2026-08-01T00:00:00.000Z",
  })
  const secondTeamOwner = await createUser({
    email: "reminder-second-owner@example.com",
    password: "Reminder123",
    name: "第二团队所有者",
    emailVerifiedAt: "2026-08-01T00:00:00.000Z",
  })

  await saveClientAccountLink({
    userId: child.id,
    parentUserId: owner.id,
    dataOwnerUserId: owner.id,
    clientId: "reminder-client-a",
    clientName: "客户 A",
    monthlyCredits: 1_000,
    operatorUserId: owner.id,
  })
  const team = await createTeam({
    ownerUserId: owner.id,
    name: "提醒协作团队",
  })
  await saveTeamMember({
    teamId: team.id,
    userId: editMember.id,
    role: "member",
    permissionKeys: ["feedback.edit"],
    operatorUserId: owner.id,
  })
  await saveTeamMember({
    teamId: team.id,
    userId: viewMember.id,
    role: "member",
    permissionKeys: ["feedback.view"],
    operatorUserId: owner.id,
  })
  await saveTeamMember({
    teamId: team.id,
    userId: unrelatedMember.id,
    role: "member",
    permissionKeys: ["client.view"],
    operatorUserId: owner.id,
  })
  await saveTeamClientShare({
    teamId: team.id,
    clientOwnerUserId: owner.id,
    clientId: "reminder-client-a",
    clientName: "客户 A",
    scope: "all",
    operatorUserId: owner.id,
  })

  assert.deepEqual(await getActionReminderSettings(owner.id), {
    version: 1,
    emailEnabled: true,
    inAppEnabled: true,
  })
  assert.deepEqual(actionReminderSchedule(), {
    pattern: "0 22 * * *",
    timezone: "Asia/Shanghai",
  })
  const email = buildActionReminderEmail({
    accountName: "提醒测试主账号",
    date: reminderDate,
    clients: [{ clientId: "reminder-client-a", clientName: "客户 <A>" }],
  })
  assert.match(email.subject, /1 个客户待录入/)
  assert.match(email.html, /客户 &lt;A&gt;/)
  assert.match(email.text, /module=feedback/)
  const readonlyEmail = buildActionReminderEmail({
    accountName: "只读成员",
    date: reminderDate,
    clients: [{
      clientId: "reminder-client-a",
      clientName: "客户 A",
      teamId: team.id,
      teamName: "提醒协作团队",
      canEdit: false,
    }],
  })
  assert.match(readonlyEmail.text, /查看进度/)
  assert.match(readonlyEmail.text, /teamId=/)
  assert.match(readonlyEmail.html, /【提醒协作团队】客户 A/)
  await Promise.all([owner, editMember, viewMember, unrelatedMember].map(user => (
    saveActionReminderSettings(user.id, {
      emailEnabled: false,
      inAppEnabled: true,
    })
  )))

  assert.deepEqual(await listEligibleActionReminderRecipientIds(), [
    editMember.id,
    owner.id,
    viewMember.id,
  ].sort())
  const before = await buildActionReminderCandidate(owner.id, reminderDate)
  assert.equal(before?.missingClients.length, 1)
  assert.equal(before?.missingClients[0]?.clientName, "客户 A")
  assert.equal(before?.missingClients[0]?.accessMode, "personal")
  assert.equal(before?.missingClients[0]?.teamId, undefined)
  assert.equal(before?.missingClients[0]?.canEdit, true)

  const editorCandidate = await buildActionReminderCandidate(editMember.id, reminderDate)
  assert.equal(editorCandidate?.missingClients.length, 1)
  assert.equal(editorCandidate?.missingClients[0]?.teamId, team.id)
  assert.equal(editorCandidate?.missingClients[0]?.canEdit, true)

  const viewerCandidate = await buildActionReminderCandidate(viewMember.id, reminderDate)
  assert.equal(viewerCandidate?.missingClients.length, 1)
  assert.equal(viewerCandidate?.missingClients[0]?.teamId, team.id)
  assert.equal(viewerCandidate?.missingClients[0]?.canEdit, false)
  assert.equal(await buildActionReminderCandidate(unrelatedMember.id, reminderDate), null)

  for (const user of [owner, editMember, viewMember]) {
    const first = await dispatchActionReminderForRecipient(user.id, reminderDate)
    const second = await dispatchActionReminderForRecipient(user.id, reminderDate)
    assert.equal(first.status, "sent")
    assert.equal(second.status, "sent")
    const notifications = await getUserNotificationSnapshot(user.id, 20)
    assert.equal(notifications.notifications.length, 1)
    assert.equal(notifications.notifications[0]?.type, "feedback_action_reminder")
    assert.match(notifications.notifications[0]?.actionUrl || "", /module=feedback/)
    if (user.id === owner.id) {
      assert.doesNotMatch(notifications.notifications[0]?.actionUrl || "", /teamId=/)
    } else {
      assert.match(notifications.notifications[0]?.actionUrl || "", /teamId=/)
    }
    assert.equal(
      notifications.notifications[0]?.metadata?.canEdit,
      user.id !== viewMember.id,
    )
  }

  const secondTeam = await createTeam({
    ownerUserId: secondTeamOwner.id,
    name: "第二提醒团队",
  })
  await saveTeamMember({
    teamId: secondTeam.id,
    userId: owner.id,
    role: "member",
    permissionKeys: ["feedback.view"],
    operatorUserId: secondTeamOwner.id,
  })
  await saveTeamMember({
    teamId: secondTeam.id,
    userId: viewMember.id,
    role: "member",
    permissionKeys: ["feedback.edit"],
    operatorUserId: secondTeamOwner.id,
  })
  await saveTeamClientShare({
    teamId: secondTeam.id,
    clientOwnerUserId: owner.id,
    clientId: "reminder-client-a",
    clientName: "客户 A",
    scope: "all",
    operatorUserId: owner.id,
  })
  const multiTeamCandidate = await buildActionReminderCandidate(viewMember.id, "2026-08-09")
  assert.equal(multiTeamCandidate?.missingClients[0]?.teamId, secondTeam.id)
  assert.equal(multiTeamCandidate?.missingClients[0]?.canEdit, true)
  await deleteTeamClientShare({
    teamId: secondTeam.id,
    clientOwnerUserId: owner.id,
    clientId: "reminder-client-a",
    operatorUserId: owner.id,
  })

  const action = await saveClientExecutionAction({
    ownerUserId: owner.id,
    clientId: "reminder-client-a",
    actorUserId: owner.id,
    value: {
      title: "完成今日发布",
      category: "self_media_publish",
      occurredAt: "2026-08-08T20:00:00+08:00",
    },
  })
  assert.equal(
    await hasClientExecutionActionOnDate(owner.id, "reminder-client-a", reminderDate),
    true,
  )
  assert.equal(
    (await buildActionReminderCandidate(owner.id, reminderDate))?.missingClients.length,
    0,
  )
  assert.equal(
    (await buildActionReminderCandidate(editMember.id, reminderDate))?.missingClients.length,
    0,
  )

  await deleteClientExecutionAction(owner.id, "reminder-client-a", action.id)
  assert.equal(
    await hasClientExecutionActionOnDate(owner.id, "reminder-client-a", reminderDate),
    false,
  )

  await saveTeamClientShare({
    teamId: team.id,
    clientOwnerUserId: owner.id,
    clientId: "reminder-client-a",
    clientName: "客户 A",
    scope: "selected",
    memberUserIds: [editMember.id],
    operatorUserId: owner.id,
  })
  assert.equal(await buildActionReminderCandidate(viewMember.id, "2026-08-09"), null)
  assert.deepEqual(await listEligibleActionReminderRecipientIds(), [
    editMember.id,
    owner.id,
  ].sort())

  await saveTeamMember({
    teamId: team.id,
    userId: editMember.id,
    role: "member",
    status: "suspended",
    permissionKeys: ["feedback.edit"],
    operatorUserId: owner.id,
  })
  assert.equal(await buildActionReminderCandidate(editMember.id, "2026-08-10"), null)
  assert.deepEqual(await listEligibleActionReminderRecipientIds(), [owner.id])

  await setClientAccountStatus({
    userId: child.id,
    status: "suspended",
    operatorUserId: owner.id,
  })
  assert.equal(await buildActionReminderCandidate(owner.id, "2026-08-09"), null)
  assert.deepEqual(await listEligibleActionReminderRecipientIds(), [])

  console.log("action reminder tests passed")
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
