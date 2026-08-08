import "server-only"

import { createHash } from "crypto"
import { getUserById } from "@/lib/auth"
import {
  getClientAccountSourceState,
  listClientAccountLinksForOwner,
  listClientAccountParentIds,
} from "@/lib/client-accounts"
import {
  hasClientExecutionActionOnDate,
  shanghaiDateOnly,
} from "@/lib/client-feedback/store"
import { kv } from "@/lib/kv"
import { notifyFeedbackActionReminder } from "@/lib/user-notifications"
import { sendActionReminderEmail } from "@/lib/action-reminders/email"

export type ActionReminderSettings = {
  version: 1
  emailEnabled: boolean
  inAppEnabled: boolean
}

export type ActionReminderClient = {
  clientId: string
  clientName: string
  dataOwnerUserId: string
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

export async function listEligibleActionReminderOwnerIds(): Promise<string[]> {
  const parentIds = await listClientAccountParentIds()
  const eligible = await Promise.all(parentIds.map(async parentUserId => {
    const links = await listClientAccountLinksForOwner(parentUserId)
    const active = await Promise.all(links.map(async link => (
      link.status === "active" && (await getClientAccountSourceState(link)).ok
    )))
    return active.some(Boolean) ? parentUserId : ""
  }))
  return eligible.filter(Boolean).sort()
}

export async function buildActionReminderCandidate(
  userId: string,
  dateValue = shanghaiDateOnly(),
): Promise<ActionReminderCandidate | null> {
  const date = cleanDate(dateValue)
  const [user, links] = await Promise.all([
    getUserById(userId),
    listClientAccountLinksForOwner(userId),
  ])
  if (!user || user.status !== "active") return null

  const activeLinks = (await Promise.all(links.map(async link => (
    link.status === "active" && (await getClientAccountSourceState(link)).ok
      ? link
      : null
  )))).filter((link): link is NonNullable<typeof link> => Boolean(link))

  const uniqueClients = new Map<string, ActionReminderClient>()
  for (const link of activeLinks) {
    const key = `${link.dataOwnerUserId}\u0000${link.clientId}`
    if (!uniqueClients.has(key)) {
      uniqueClients.set(key, {
        clientId: link.clientId,
        clientName: link.clientName,
        dataOwnerUserId: link.dataOwnerUserId,
      })
    }
  }
  if (uniqueClients.size === 0) return null

  const clients = [...uniqueClients.values()]
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

export async function dispatchActionReminderForOwner(
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
