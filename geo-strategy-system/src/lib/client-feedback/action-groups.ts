import type {
  ClientExecutionAction,
  ClientExecutionActionCategory,
  ClientExecutionActionPublication,
} from "@/types/client-feedback"

const PUBLICATION_CATEGORIES = new Set<ClientExecutionActionCategory>([
  "self_media_publish",
  "authority_media_publish",
  "video_publish",
])

export type ClientExecutionActionGroup = {
  key: string
  action: ClientExecutionAction
  actions: ClientExecutionAction[]
  actionIds: string[]
  isBatch: boolean
  isPublication: boolean
  itemCount: number
  totalQuantity: number
  unit: string
  evidenceCount: number
  publication: ClientExecutionActionPublication
}

function actionPublication(
  action: ClientExecutionAction,
): ClientExecutionActionPublication {
  if (action.publication) return action.publication
  return action.visibility === "client" ? "summary" : "internal"
}

function groupKey(action: ClientExecutionAction): string {
  if (!action.importBatchId) return `action:${action.id}`
  return [
    "batch",
    action.importBatchId,
    action.category,
    actionPublication(action),
  ].join(":")
}

export function groupClientExecutionActions(
  actions: ClientExecutionAction[],
): ClientExecutionActionGroup[] {
  const grouped = new Map<string, ClientExecutionAction[]>()
  for (const action of actions) {
    const key = groupKey(action)
    grouped.set(key, [...(grouped.get(key) || []), action])
  }

  return [...grouped.entries()].map(([key, groupActions]) => {
    const action = groupActions[0]
    const evidenceCount = groupActions.reduce(
      (sum, item) => sum + item.evidence.length,
      0,
    )
    const quantity = groupActions.reduce((sum, item) => (
      sum + (
        typeof item.quantity === "number" && Number.isFinite(item.quantity)
          ? Math.max(0, item.quantity)
          : 0
      )
    ), 0)
    const itemCount = evidenceCount || groupActions.length
    return {
      key,
      action,
      actions: groupActions,
      actionIds: groupActions.map(item => item.id),
      isBatch: Boolean(action.importBatchId && groupActions.length > 1),
      isPublication: PUBLICATION_CATEGORIES.has(action.category),
      itemCount,
      totalQuantity: quantity > 0 ? quantity : itemCount,
      unit: action.unit || (action.category === "video_publish" ? "条" : "篇"),
      evidenceCount,
      publication: actionPublication(action),
    }
  })
}
