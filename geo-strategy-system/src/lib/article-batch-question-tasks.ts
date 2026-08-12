import type { ArticleBatchQuestionTask } from "@/types"

function normalizedQuestion(value: string): string {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .toLocaleLowerCase("zh-CN")
}

function stableTaskKey(task: ArticleBatchQuestionTask): string {
  if (task.materialId) return `material:${task.materialId}`
  if (task.questionId) return `question:${task.questionId}`
  return ""
}

export function resolveArticleBatchQuestionTasks(input: {
  topicText: string
  count: number
  availableTasks: ArticleBatchQuestionTask[]
  preferredTasks?: ArticleBatchQuestionTask[]
}): ArticleBatchQuestionTask[] {
  const lines = String(input.topicText || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, Math.max(0, Math.floor(input.count)))
  const indexed = input.availableTasks.map((task, index) => ({
    task,
    key: stableTaskKey(task) || `available:${index}`,
  }))
  const availableKeys = new Set(indexed.map(item => item.key))
  const byQuestion = new Map<string, typeof indexed>()
  for (const candidate of indexed) {
    const key = normalizedQuestion(candidate.task.question)
    const matches = byQuestion.get(key)
    if (matches) matches.push(candidate)
    else byQuestion.set(key, [candidate])
  }

  const used = new Set<string>()
  return lines.map((question, index) => {
    const questionKey = normalizedQuestion(question)
    const preferred = input.preferredTasks?.[index]
    const preferredKey = preferred ? stableTaskKey(preferred) : ""
    const preferredMatches = preferred
      && normalizedQuestion(preferred.question) === questionKey
      && Boolean(preferredKey)
      && availableKeys.has(preferredKey)
      && !used.has(preferredKey)
    const fallback = (byQuestion.get(questionKey) || [])
      .find(candidate => !used.has(candidate.key))
    const selected = preferredMatches
      ? { task: preferred, key: preferredKey }
      : fallback

    if (selected) used.add(selected.key)
    return {
      ...selected?.task,
      question,
    }
  })
}
