import { createHash } from "node:crypto"

import type {
  PenetrationRequestAudit,
  PenetrationSearchMode,
} from "@/types"
import type { ChatArgs } from "./openai-compat"

interface PromptMessage {
  role?: unknown
  content?: unknown
}

interface BlindRequestAuditInput {
  endpoint: string
  model: string
  modelProvider: string
  searchProvider: string
  searchMode: PenetrationSearchMode
  messages: PromptMessage[]
  tools?: unknown[]
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function endpointHost(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return "invalid-endpoint"
  }
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map(part => {
      if (!part || typeof part !== "object") return ""
      const value = part as { text?: unknown; content?: unknown }
      if (typeof value.text === "string") return value.text
      if (typeof value.content === "string") return value.content
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function toolName(tool: unknown): string {
  if (!tool || typeof tool !== "object") return "unknown"
  const value = tool as {
    type?: unknown
    name?: unknown
    function?: { name?: unknown }
  }
  if (typeof value.function?.name === "string") return value.function.name
  if (typeof value.name === "string") return value.name
  if (typeof value.type === "string") return value.type
  return "unknown"
}

export function isStrictPenetrationBlindArgs(
  args: Pick<
    ChatArgs,
    | "system"
    | "user"
    | "mode"
    | "forceWebSearch"
    | "rawQuestionOnly"
    | "requireWebEvidence"
    | "officialWebOnly"
  >,
): boolean {
  return (
    args.mode === "consumer"
    && args.forceWebSearch === true
    && args.rawQuestionOnly === true
    && args.requireWebEvidence === true
    && args.officialWebOnly === true
  )
}

export function assertStrictPenetrationBlindArgs(args: ChatArgs): void {
  if (!isStrictPenetrationBlindArgs(args)) {
    throw new Error(
      "纯净联网盲测已阻断：疑问句检测必须启用单轮原问题、强制联网和可审计信源。",
    )
  }
  if (args.system !== "") {
    throw new Error("纯净联网盲测已阻断：检测请求不得携带 system Prompt。")
  }
  if (!args.user.trim()) {
    throw new Error("纯净联网盲测已阻断：原始疑问句不能为空。")
  }
}

export function buildPenetrationRequestAudit(
  args: ChatArgs,
  input: BlindRequestAuditInput,
): PenetrationRequestAudit {
  const roles = input.messages.map(message =>
    typeof message.role === "string" ? message.role : "unknown"
  )
  const systemMessageCount = roles.filter(role => role === "system").length
  const userMessages = input.messages.filter(message => message.role === "user")
  const userMessageCount = userMessages.length
  const exactQuestionMatch =
    userMessageCount === 1
    && messageText(userMessages[0]?.content) === args.user
  const additionalPromptTextDetected = input.messages.some(message => {
    if (message.role === "user") return messageText(message.content) !== args.user
    return messageText(message.content).trim().length > 0
  })
  const canonicalPrompt = input.messages.map(message => ({
    role: typeof message.role === "string" ? message.role : "unknown",
    content: messageText(message.content),
  }))
  const verified =
    isStrictPenetrationBlindArgs(args)
    && systemMessageCount === 0
    && userMessageCount === 1
    && input.messages.length === 1
    && exactQuestionMatch
    && !additionalPromptTextDetected

  return {
    schemaVersion: 1,
    endpointHost: endpointHost(input.endpoint),
    model: input.model,
    modelProvider: input.modelProvider,
    searchProvider: input.searchProvider,
    searchMode: input.searchMode,
    messageRoles: roles,
    systemMessageCount,
    userMessageCount,
    additionalPromptTextDetected,
    exactQuestionMatch,
    questionSha256: sha256(args.user),
    promptSha256: sha256(JSON.stringify(canonicalPrompt)),
    toolNames: (input.tools || []).map(toolName),
    verified,
    verifiedAt: new Date().toISOString(),
  }
}

export function emitPenetrationRequestAudit(
  args: ChatArgs,
  input: BlindRequestAuditInput,
): PenetrationRequestAudit | null {
  if (!isStrictPenetrationBlindArgs(args)) return null
  const audit = buildPenetrationRequestAudit(args, input)
  args.onRequestAudit?.(audit)
  if (!audit.verified) {
    throw new Error(
      "纯净联网盲测已阻断：真实出站消息并非单条原始疑问句，未向模型发送。",
    )
  }
  return audit
}
