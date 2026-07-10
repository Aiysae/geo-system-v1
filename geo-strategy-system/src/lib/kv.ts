import "server-only"

import fs from "fs"
import path from "path"
import { kv as vercelKv } from "@vercel/kv"

type SetOptions = {
  nx?: boolean
  ex?: number
}

type LocalValueEntry = {
  type: "value"
  value: unknown
  expiresAt?: number
}

type LocalSetEntry = {
  type: "set"
  members: string[]
  expiresAt?: number
}

type LocalEntry = LocalValueEntry | LocalSetEntry
type LocalState = Record<string, LocalEntry>

type KvClient = {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown, options?: SetOptions): Promise<"OK" | null>
  sadd(key: string, ...members: string[]): Promise<number>
  smembers<T = string[]>(key: string): Promise<T>
  del(key: string): Promise<number>
  srem(key: string, ...members: string[]): Promise<number>
  incrby(key: string, amount: number): Promise<number>
  decrby(key: string, amount: number): Promise<number>
  eval<TResult = unknown, TData = unknown>(
    script: string,
    keys: string[],
    args: TData[],
  ): Promise<TResult>
}

const DEFAULT_LOCAL_KV_FILE = process.env.NODE_ENV === "production"
  ? "/var/lib/geo-system/kv.json"
  : path.join(process.cwd(), ".data", "kv.json")

const useLocalKv = process.env.KV_BACKEND === "file"
  || !process.env.KV_REST_API_URL
  || !process.env.KV_REST_API_TOKEN

function expiresAtFromOptions(options?: SetOptions): number | undefined {
  if (!options?.ex || !Number.isFinite(options.ex)) return undefined
  return Date.now() + Math.max(1, Math.floor(options.ex)) * 1000
}

class LocalFileKv implements KvClient {
  private readonly filePath: string
  private state: LocalState

  constructor(filePath = process.env.LOCAL_KV_FILE || DEFAULT_LOCAL_KV_FILE) {
    this.filePath = filePath
    this.state = this.load()
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.getEntry(key)
    if (!entry || entry.type !== "value") return null
    return entry.value as T
  }

  async set(key: string, value: unknown, options?: SetOptions): Promise<"OK" | null> {
    if (options?.nx && this.getEntry(key)) return null
    this.state[key] = {
      type: "value",
      value,
      expiresAt: expiresAtFromOptions(options),
    }
    this.persist()
    return "OK"
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const current = this.getEntry(key)
    const set = new Set(current?.type === "set" ? current.members : [])
    const before = set.size
    for (const member of members) set.add(String(member))
    this.state[key] = { type: "set", members: [...set] }
    this.persist()
    return set.size - before
  }

  async smembers<T = string[]>(key: string): Promise<T> {
    const current = this.getEntry(key)
    return (current?.type === "set" ? current.members : []) as T
  }

  async del(key: string): Promise<number> {
    const exists = Boolean(this.getEntry(key))
    delete this.state[key]
    if (exists) this.persist()
    return exists ? 1 : 0
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const current = this.getEntry(key)
    if (!current || current.type !== "set") return 0
    const remove = new Set(members.map(String))
    const next = current.members.filter(member => !remove.has(member))
    const removed = current.members.length - next.length
    if (removed > 0) {
      this.state[key] = { ...current, members: next }
      this.persist()
    }
    return removed
  }

  async incrby(key: string, amount: number): Promise<number> {
    return this.increment(key, amount)
  }

  async decrby(key: string, amount: number): Promise<number> {
    return this.increment(key, -amount)
  }

  async eval<TResult = unknown, TData = unknown>(
    script: string,
    keys: string[],
    args: TData[],
  ): Promise<TResult> {
    if (script.includes("admin_adjustment_v1")) {
      return this.evalAdminAdjustment(keys, args) as TResult
    }
    if (script.includes('redis.call("INCR"')) {
      return this.evalRateLimit(keys[0], args) as TResult
    }
    if (script.includes("next_balance") && script.includes('redis.call("SET"')) {
      return this.evalReserveCredits(keys[0], args) as TResult
    }
    throw new Error("Local KV does not support this eval script")
  }

  private getEntry(key: string): LocalEntry | null {
    const entry = this.state[key]
    if (!entry) return null
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      delete this.state[key]
      this.persist()
      return null
    }
    return entry
  }

  private increment(key: string, delta: number): number {
    const current = this.getEntry(key)
    const currentValue = current?.type === "value" ? Number(current.value) : 0
    const next = (Number.isFinite(currentValue) ? currentValue : 0) + Math.floor(delta)
    this.state[key] = { type: "value", value: next, expiresAt: current?.expiresAt }
    this.persist()
    return next
  }

  private evalRateLimit<TData>(key: string, args: TData[]): [number, number] {
    const windowSec = Math.max(1, Number(args[1] ?? 60))
    const current = this.getEntry(key)
    const count = this.increment(key, 1)
    const entry = this.getEntry(key)
    if (!current && entry?.type === "value") {
      entry.expiresAt = Date.now() + windowSec * 1000
      this.persist()
    }
    const ttl = entry?.expiresAt
      ? Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000))
      : windowSec
    return [count, ttl]
  }

  private evalReserveCredits<TData>(key: string, args: TData[]): [number, number] {
    const initial = Number(args[0] ?? 0)
    const amount = Number(args[1] ?? 0)
    const current = this.getEntry(key)
    const balance = current?.type === "value" ? Number(current.value) : initial
    const safeBalance = Number.isFinite(balance) ? balance : 0

    if (!current) {
      this.state[key] = { type: "value", value: safeBalance }
      this.persist()
    }
    if (amount <= 0) return [1, safeBalance]
    if (safeBalance < amount) return [0, safeBalance]

    const next = safeBalance - amount
    this.state[key] = { type: "value", value: next }
    this.persist()
    return [1, next]
  }

  private evalAdminAdjustment<TData>(keys: string[], args: TData[]): [number, number | string] {
    const [key, operationKey] = keys
    const completed = this.getEntry(operationKey)
    if (completed?.type === "value") {
      return [2, typeof completed.value === "string" ? completed.value : JSON.stringify(completed.value)]
    }

    const initial = Number(args[0] ?? 0)
    const delta = Math.trunc(Number(args[1] ?? 0))
    const pendingResult = String(args[2] ?? "")
    const ttlSeconds = Number(args[3] ?? 0)
    const current = this.getEntry(key)
    const currentValue = current?.type === "value" ? Number(current.value) : initial
    const balance = Number.isFinite(currentValue) ? currentValue : 0
    const next = balance + delta

    if (!Number.isFinite(delta) || delta === 0 || next < 0) return [0, balance]
    let result: Record<string, unknown>
    try {
      result = JSON.parse(pendingResult) as Record<string, unknown>
    } catch {
      return [0, balance]
    }
    result.balance = next
    const encoded = JSON.stringify(result)
    this.state[key] = { type: "value", value: next, expiresAt: current?.expiresAt }
    this.state[operationKey] = {
      type: "value",
      value: result,
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined,
    }
    this.persist()
    return [1, encoded]
  }

  private load(): LocalState {
    try {
      if (!fs.existsSync(this.filePath)) return {}
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
      return parsed as LocalState
    } catch (error) {
      console.warn("[kv] Failed to load local KV file; starting with empty store", error)
      return {}
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const tmpPath = `${this.filePath}.${process.pid}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(this.state), "utf8")
    fs.renameSync(tmpPath, this.filePath)
  }
}

export const kv: KvClient = useLocalKv ? new LocalFileKv() : (vercelKv as KvClient)
