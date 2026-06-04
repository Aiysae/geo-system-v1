export function withBeijingTime(system: string): string {
  const now = new Date()
  const beijing = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }))
  return `[当前北京时间：${beijing.toISOString().replace("T", " ").slice(0, 19)}]\n\n${system}`
}
