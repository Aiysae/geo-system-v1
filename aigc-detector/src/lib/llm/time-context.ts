// 动态时间基准注入器
//
// 目的：在所有大模型的 system prompt 头部强制注入"当前北京时间"，
//      让模型对"今天/最近"这类时间相关问题不必次次联网。

const WEEKDAYS_ZH = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]

export function buildBeijingTimeHeader(now: Date = new Date()): string {
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
  let weekday = get("weekday")
  if (!weekday) {
    const shanghai = new Date(now.getTime() + (8 * 60 - now.getTimezoneOffset()) * 60_000)
    weekday = WEEKDAYS_ZH[shanghai.getUTCDay()]
  }

  return [
    `【当前北京时间】${year}年${month}月${day}日 ${weekday} ${hour}:${minute}:${second}`,
  ].join("\n")
}

export function withBeijingTime(originalSystem: string | undefined | null): string {
  const header = buildBeijingTimeHeader()
  const base = (originalSystem ?? "").trimStart()
  if (!base) return header
  return `${header}\n\n${base}`
}
