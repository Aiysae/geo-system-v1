export const DIFFICULTY_RING_COLORS = [
  "#1677FF",
  "#00AEEA",
  "#13C2C2",
  "#2F54EB",
  "#6C5CE7",
  "#16A34A",
  "#F59E0B",
] as const

export function difficultyDimensionPercent(score: number, max: number): number {
  const safeScore = Number.isFinite(score) ? score : 0
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1
  return Math.max(0, Math.min(100, Math.round((safeScore / safeMax) * 100)))
}
