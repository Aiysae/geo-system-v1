import "server-only"

import { AsyncLocalStorage } from "node:async_hooks"

export type AgentInvocationContext = {
  userId: string
  tokenId: string
  traceId: string
}

const storage = new AsyncLocalStorage<AgentInvocationContext>()

export function runWithAgentActor<T>(
  context: AgentInvocationContext,
  operation: () => T,
): T {
  return storage.run(context, operation)
}

export function getAgentInvocationContext(): AgentInvocationContext | null {
  return storage.getStore() || null
}
