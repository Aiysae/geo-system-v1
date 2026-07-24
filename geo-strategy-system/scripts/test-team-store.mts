import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-team-store-"))
process.env.TEAM_STORE = "file"
process.env.TEAM_FILE = path.join(directory, "teams.json")
delete process.env.DATABASE_URL

try {
  const imported = await import("../src/lib/team-store")
  const store = (
    "default" in imported ? imported.default : imported
  ) as typeof import("../src/lib/team-store")

  const ownerUserId = "test-owner"
  const memberUserId = "test-member"
  const outsiderUserId = "test-outsider"
  const memberEmail = "member@example.com"

  const team = await store.createTeam({
    ownerUserId,
    name: "测试协作团队",
  })
  assert.equal(team.ownerUserId, ownerUserId)
  assert.equal((await store.listTeamMembers(team.id)).length, 1)

  const { invite, token } = await store.createTeamInvite({
    teamId: team.id,
    email: memberEmail,
    role: "member",
    permissionKeys: [
      "client.view",
      "penetration.execute",
      "article.view",
    ],
    operatorUserId: ownerUserId,
  })
  assert.equal(invite.status, "pending")
  assert.ok(token.length >= 32)
  await assert.rejects(
    store.acceptTeamInvite({
      token,
      userId: memberUserId,
      userEmail: "wrong@example.com",
    }),
    /收到邀请的邮箱/,
  )

  const member = await store.acceptTeamInvite({
    token,
    userId: memberUserId,
    userEmail: memberEmail,
  })
  assert.equal(member.status, "active")
  assert.ok(member.permissionKeys.includes("penetration.execute"))
  assert.ok(member.permissionKeys.includes("penetration.view"))
  assert.equal((await store.getTeamInviteByToken(token))?.status, "accepted")

  await store.saveTeamClientShare({
    teamId: team.id,
    clientOwnerUserId: ownerUserId,
    clientId: "client-a",
    clientName: "客户 A",
    scope: "selected",
    memberUserIds: [memberUserId],
    operatorUserId: ownerUserId,
  })
  assert.equal(
    (await store.listAccessibleTeamClientShares(memberUserId, team.id))[0]?.share.clientId,
    "client-a",
  )
  assert.equal(
    (await store.listAccessibleTeamClientShares(outsiderUserId, team.id)).length,
    0,
  )

  const access = await store.findTeamClientAccess({
    userId: memberUserId,
    teamId: team.id,
    clientId: "client-a",
  })
  assert.equal(access?.billingUserId, ownerUserId)
  assert.ok(access?.permissionKeys.includes("penetration.execute"))

  await store.saveTeamMember({
    teamId: team.id,
    userId: memberUserId,
    role: "member",
    status: "suspended",
    permissionKeys: member.permissionKeys,
    operatorUserId: ownerUserId,
  })
  assert.equal(
    (await store.listAccessibleTeamClientShares(memberUserId, team.id)).length,
    0,
  )

  const actions = new Set((await store.listTeamAudit(team.id)).map(item => item.action))
  assert.ok(actions.has("team_created"))
  assert.ok(actions.has("member_invited"))
  assert.ok(actions.has("member_joined"))
  assert.ok(actions.has("client_shared"))
  assert.ok(actions.has("member_suspended"))

  console.log("Team file-store integration tests passed.")
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
