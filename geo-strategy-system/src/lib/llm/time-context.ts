// 动态时间基准注入器
//
// 目的：在所有大模型的 system prompt 头部强制注入"当前北京时间"，
//      让模型对"今天/最近"这类时间相关问题不必次次联网，
//      也避免 DeepSeek 用 2024 训练截止时间瞎答 2026 年的问题。
//
// 注入策略：每次调用动态计算，避免 module 初始化时被缓存。

const WEEKDAYS_ZH = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]

/**
 * 构造一段简洁的"当前北京时间"文本块，例如：
 *
 *   【当前准确的北京时间】2026年5月14日 星期四 14:23:07（UTC+8）
 *   - 请以此时间为准回答任何涉及"今天/现在/最近/本年"的问题。
 *   - 若用户的问题不涉及该时间之后的最新资讯，无需触发联网搜索。
 */
export function buildBeijingTimeHeader(now: Date = new Date()): string {
  // 用 Asia/Shanghai 时区取各字段，避免容器时区影响
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "long",
  })
  const parts = fmt.formatToParts(now)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ""
  const year = get("year")
  const month = get("month").replace(/^0/, "")
  const day = get("day").replace(/^0/, "")
  const hour = get("hour")
  const minute = get("minute")
  const second = get("second")
  // weekday 在 zh-CN 下直接给"星期四"
  let weekday = get("weekday")
  if (!weekday) {
    // 兜底：用 UTC+8 偏移自算
    const shanghai = new Date(now.getTime() + (8 * 60 - now.getTimezoneOffset()) * 60_000)
    weekday = WEEKDAYS_ZH[shanghai.getUTCDay()]
  }

  return [
    `【当前北京时间】${year}年${month}月${day}日 ${weekday} ${hour}:${minute}:${second}`,
  ].join("\n")
}

/**
 * 把"北京时间块"拼到调用方原始 system prompt 的最顶部。
 * 调用方原始 system 为空时也会注入；为 undefined 时返回纯时间块。
 */
export function withBeijingTime(originalSystem: string | undefined | null): string {
  const header = buildBeijingTimeHeader()
  const base = (originalSystem ?? "").trimStart()
  if (!base) return header
  return `${header}\n\n${base}`
}
