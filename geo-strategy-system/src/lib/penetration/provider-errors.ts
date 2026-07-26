import type { ModelKey } from "@/types"

export function isPermanentPenetrationProviderError(message: string): boolean {
  return /AccountOverdueError|overdue balance|insufficient balance|余额不足|欠费|invalid[_ ]api[_ ]key|incorrect api key|unauthorized|HTTP 401|HTTP 403|does not exist or you do not have access|InvalidEndpointOrModel|ModelNotOpen|model_offline|model is offline|model.*not.*available|unsupported.*web[_ ]?search|does not support.*web[_ ]?search|not support.*web[_ ]?search|权限不足|无权访问/i.test(
    message,
  )
}

export function isTransientPenetrationCapacityError(message: string): boolean {
  return /账号任务较多|排队等待超时|too many requests|rate.?limit|HTTP 429|并发(?:数|量|上限)|限流|请求过于频繁|服务繁忙|server busy|temporarily unavailable|connection pool|timeout acquiring/i.test(
    message,
  )
}

export function formatPenetrationProviderError(model: ModelKey, message: string): string {
  if (model === "doubao" && /AccountOverdueError|overdue balance|余额不足|欠费/i.test(message)) {
    return "火山方舟账号存在欠费，豆包联网请求已被平台拒绝。请结清火山方舟欠费或更换有余额的 API Key。"
  }
  if (model === "doubao" && /InvalidEndpointOrModel|does not exist or you do not have access/i.test(message)) {
    return "豆包模型不存在或当前火山方舟账号无权访问，请检查后台豆包模型和 API Key。"
  }
  if (model === "ernie" && /HTTP 401|HTTP 403|unauthorized|权限不足|无权访问/i.test(message)) {
    return "百度千帆 API Key 没有百度 AI 搜索或所选文心模型权限，请在千帆控制台补充权限后重试。"
  }
  if (model === "kimi" && /HTTP 401|HTTP 403|unauthorized|权限不足|无权访问/i.test(message)) {
    return "Kimi 严格联网需要百度 AI 搜索调用 Kimi 模型，当前百度千帆 API Key 权限不足。"
  }
  return message
}
