import "server-only"

import { createHash } from "crypto"
import { getUserById } from "@/lib/auth"
import {
  getClientAccountSourceState,
  listClientAccountLinks,
  listClientAccountLinksForOwner,
  type ClientAccountLink,
} from "@/lib/client-accounts"
import {
  hasClientExecutionActionOnDate,
  shanghaiDateOnly,
} from "@/lib/client-feedback/store"
import { kv } from "@/lib/kv"
import { notifyFeedbackActionReminder } from "@/lib/user-notifications"
import { sendActionReminderEmail } from "@/lib/action-reminders/email"
import { listTeamActionReminderAccesses } from "@/lib/team-store"

export type ActionReminderSettings = {
  version: 1
  emailEnabled: boolean
  inAppEnabled: boolean
}

export type ActionReminderClient = {
  clientId: string
  clientName: string
  dataOwnerUserId: string
  accessMode: "personal" | "team"
  canEdit: boolean
  teamId?: string
  teamName?: string
}

export type ActionReminderCandidate = {
  userId: string
  email: string
  accountName: string
  emailVerified: boolean
  missingClients: ActionReminderClient[]
}

export type ActionReminderDispatchRecord = {
  version: 1
  id: string
  userId: string
  date: string
  status: "pending" | "sent" | "skipped" | "failed"
  inAppStatus: "pending" | "sent" | "disabled"
  emailStatus: "pending" | "sent" | "disabled" | "unverified" | "failed"
  missingClientCount: number
  editableClientCount?: number
  teamCount?: number
  attempts: number
  createdAt: string
  updatedAt: string
  sentAt?: string
  error?: string
}

const DEFAULT_SETTINGS: ActionReminderSettings = {
  version: 1,
  emailEnabled: true,
  inAppEnabled: true,
}
const RECORD_TTL_SECONDS = 60 * 60 * 24 * 400
const LOCK_TTL_SECONDS = 5 * 60

const settingsKey = (userId: string) => `geo:action-reminder:settings:${userId}`
const recordKey = (userId: string, date: string) => `geo:action-reminder:record:${date}:${userId}`
const lockKey = (userId: string, date: string) => `geo:action-reminder:lock:${date}:${userId}`

function reminderClientKey(input: {
  dataOwnerUserId: string
  clientId: string
}): string {
  return `${input.dataOwnerUserId}\u0000${input.clientId}`
}

async function filterActiveReminderLinks(
  links: ClientAccountLink[],
): Promise<ClientAccountLink[]> {
  const active = await Promise.all(links.map(async link => (
    link.status === "active" && (await getClientAccountSourceState(link)).ok
      ? link
      : null
  )))
  return active.filter((link): link is ClientAccountLink => Boolean(link))
}

async function listActiveReminderLinks(): Promise<ClientAccountLink[]> {
  return filterActiveReminderLinks(await listClientAccountLinks())
}

async function listActiveReminderLinksForParents(
  parentUserIds: readonly string[],
): Promise<ClientAccountLink[]> {
  const uniqueParentIds = [...new Set(parentUserIds.map(String).filter(Boolean))]
  const groups = await Promise.all(uniqueParentIds.map(listClientAccountLinksForOwner))
  const uniqueLinks = new Map<string, ClientAccountLink>()
  for (const link of groups.flat()) uniqueLinks.set(link.userId, link)
  return filterActiveReminderLinks([...uniqueLinks.values()])
}

function cleanDate(value: string): string {
  const date = String(value || "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("提醒日期无效")
  return date
}

function dispatchId(userId: string, date: string): string {
  const digest = createHash("sha256")
    .update(`${userId}\u0000${date}`)
    .digest("hex")
    .slice(0, 32)
  return `action_reminder_${digest}`
}

export async function getActionReminderSettings(
  userId: string,
): Promise<ActionReminderSettings> {
  const stored = await kv.get<Partial<ActionReminderSettings>>(settingsKey(userId))
  if (!stored) return DEFAULT_SETTINGS
  return {
    version: 1,
    emailEnabled: stored.emailEnabled !== false,
    inAppEnabled: stored.inAppEnabled !== false,
  }
}

export async function saveActionReminderSettings(
  userId: string,
  patch: Partial<Pick<ActionReminderSettings, "emailEnabled" | "inAppEnabled">>,
): Promise<ActionReminderSettings> {
  const current = await getActionReminderSettings(userId)
  const next: ActionReminderSettings = {
    version: 1,
    emailEnabled: typeof patch.emailEnabled === "boolean"
      ? patch.emailEnabled
      : current.emailEnabled,
    inAppEnabled: typeof patch.inAppEnabled === "boolean"
      ? patch.inAppEnabled
      : current.inAppEnabled,
  }
  await kv.set(settingsKey(userId), next)
  return next
}

export async function listEligibleActionReminderRecipientIds(): Promise<string[]> {
  const [activeLinks, teamAccesses] = await Promise.all([
    listActiveReminderLinks(),
    listTeamActionReminderAccesses(),
  ])
  const activeClientKeys = new Set(activeLinks.map(reminderClientKey))
  const recipientIds = new Set(activeLinks.map(link => link.parentUserId))
  for (const access of teamAccesses) {
    if (activeClientKeys.has(reminderClientKey({
      dataOwnerUserId: access.clientOwnerUserId,
      clientId: access.clientId,
    }))) {
      recipientIds.add(access.userId)
    }
  }
  return [...recipientIds].filter(Boolean).sort()
}

/** @deprecated Use the recipient-based name; kept for queued-job compatibility. */
export async function listEligibleActionReminderOwnerIds(): Promise<string[]> {
  return listEligibleActionReminderRecipientIds()
}

export async function buildActionReminderCandidate(
  userId: string,
  dateValue = shanghaiDateOnly(),
): Promise<ActionReminderCandidate | null> {
  const date = cleanDate(dateValue)
  const [user, teamAccesses] = await Promise.all([
    getUserById(userId),
    listTeamActionReminderAccesses(userId),
  ])
  if (!user || user.status !== "active") return null
  const activeLinks = await listActiveReminderLinksForParents([
    userId,
    ...teamAccesses.map(access => access.teamOwnerUserId),
  ])

  const activeClientKeys = new Set(activeLinks.map(reminderClientKey))
  const uniqueClients = new Map<string, ActionReminderClient>()
  for (const link of activeLinks.filter(item => item.parentUserId === userId)) {
    const key = reminderClientKey(link)
    if (!uniqueClients.has(key)) {
      uniqueClients.set(key, {
        clientId: link.clientId,
        clientName: link.clientName,
        dataOwnerUserId: link.dataOwnerUserId,
        accessMode: link.sourceType === "team" ? "team" : "personal",
        canEdit: true,
        teamId: link.teamId,
      })
    }
  }
  for (const access of teamAccesses) {
    const key = reminderClientKey({
      dataOwnerUserId: access.clientOwnerUserId,
      clientId: access.clientId,
    })
    if (!activeClientKeys.has(key)) continue
    const existing = uniqueClients.get(key)
    if (existing?.accessMode === "personal") continue
    if (existing?.canEdit && !access.canEdit) continue
    uniqueClients.set(key, {
      clientId: access.clientId,
      clientName: access.clientName || existing?.clientName || "客户档案",
      dataOwnerUserId: access.clientOwnerUserId,
      accessMode: "team",
      canEdit: access.canEdit,
      teamId: access.teamId,
      teamName: access.teamName,
    })
  }
  if (uniqueClients.size === 0) return null

  const clients = [...uniqueClients.values()].sort((left, right) => (
    Number(right.canEdit) - Number(left.canEdit)
    || String(left.teamName || "").localeCompare(String(right.teamName || ""), "zh-CN")
    || left.clientName.localeCompare(right.clientName, "zh-CN")
  ))
  const recorded = await Promise.all(clients.map(client => (
    hasClientExecutionActionOnDate(client.dataOwnerUserId, client.clientId, date)
  )))
  const missingClients = clients.filter((_, index) => !recorded[index])

  return {
    userId: user.id,
    email: user.email,
    accountName: user.name,
    emailVerified: Boolean(user.emailVerifiedAt),
    missingClients,
  }
}

async function saveDispatchRecord(
  record: ActionReminderDispatchRecord,
): Promise<ActionReminderDispatchRecord> {
  await kv.set(recordKey(record.userId, record.date), record, { ex: RECORD_TTL_SECONDS })
  return record
}

export async function getActionReminderDispatchRecord(
  userId: string,
  date: string,
): Promise<ActionReminderDispatchRecord | null> {
  return await kv.get<ActionReminderDispatchRecord>(recordKey(userId, cleanDate(date)))
}

export async function dispatchActionReminderForRecipient(
  userId: string,
  dateValue = shanghaiDateOnly(),
): Promise<ActionReminderDispatchRecord> {
  const date = cleanDate(dateValue)
  const existing = await getActionReminderDispatchRecord(userId, date)
  if (existing?.status === "sent" || existing?.status === "skipped") return existing

  const lockToken = createHash("sha256")
    .update(`${process.pid}:${Date.now()}:${Math.random()}`)
    .digest("hex")
  const locked = await kv.set(lockKey(userId, date), lockToken, {
    nx: true,
    ex: LOCK_TTL_SECONDS,
  })
  if (!locked) {
    return existing || {
      version: 1,
      id: dispatchId(userId, date),
      userId,
      date,
      status: "pending",
      inAppStatus: "pending",
      emailStatus: "pending",
      missingClientCount: 0,
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  try {
    const latest = await getActionReminderDispatchRecord(userId, date)
    if (latest?.status === "sent" || latest?.status === "skipped") return latest
    const [candidate, settings] = await Promise.all([
      buildActionReminderCandidate(userId, date),
      getActionReminderSettings(userId),
    ])
    const now = new Date().toISOString()
    const base: ActionReminderDispatchRecord = latest || {
      version: 1,
      id: dispatchId(userId, date),
      userId,
      date,
      status: "pending",
      inAppStatus: settings.inAppEnabled ? "pending" : "disabled",
      emailStatus: settings.emailEnabled ? "pending" : "disabled",
      missingClientCount: candidate?.missingClients.length || 0,
      editableClientCount: candidate?.missingClients.filter(client => client.canEdit).length || 0,
      teamCount: new Set(candidate?.missingClients.map(client => client.teamId).filter(Boolean)).size,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }

    if (!candidate || candidate.missingClients.length === 0) {
      return await saveDispatchRecord({
        ...base,
        status: "skipped",
        missingClientCount: 0,
        updatedAt: now,
      })
    }

    let record = await saveDispatchRecord({
      ...base,
      status: "pending",
      missingClientCount: candidate.missingClients.length,
      editableClientCount: candidate.missingClients.filter(client => client.canEdit).length,
      teamCount: new Set(candidate.missingClients.map(client => client.teamId).filter(Boolean)).size,
      attempts: base.attempts + 1,
      updatedAt: now,
    })

    if (settings.inAppEnabled && record.inAppStatus !== "sent") {
      await notifyFeedbackActionReminder({
        userId,
        date,
        clients: candidate.missingClients,
      })
      record = await saveDispatchRecord({
        ...record,
        inAppStatus: "sent",
        updatedAt: new Date().toISOString(),
      })
    }

    if (!settings.emailEnabled) {
      record = { ...record, emailStatus: "disabled" }
    } else if (!candidate.emailVerified) {
      record = { ...record, emailStatus: "unverified" }
    } else if (record.emailStatus !== "sent") {
      try {
        await sendActionReminderEmail({
          to: candidate.email,
          accountName: candidate.accountName,
          date,
          clients: candidate.missingClients,
        })
        record = { ...record, emailStatus: "sent" }
      } catch (error) {
        const failed = await saveDispatchRecord({
          ...record,
          status: "failed",
          emailStatus: "failed",
          error: error instanceof Error ? error.message : "提醒邮件发送失败",
          updatedAt: new Date().toISOString(),
        })
        throw Object.assign(new Error(failed.error), { record: failed })
      }
    }

    const completedAt = new Date().toISOString()
    return await saveDispatchRecord({
      ...record,
      status: "sent",
      error: undefined,
      sentAt: completedAt,
      updatedAt: completedAt,
    })
  } finally {
    if (await kv.get<string>(lockKey(userId, date)) === lockToken) {
      await kv.del(lockKey(userId, date))
    }
  }
}

/** @deprecated Use dispatchActionReminderForRecipient. */
export async function dispatchActionReminderForOwner(
  userId: string,
  dateValue = shanghaiDateOnly(),
): Promise<ActionReminderDispatchRecord> {
  return dispatchActionReminderForRecipient(userId, dateValue)
}
