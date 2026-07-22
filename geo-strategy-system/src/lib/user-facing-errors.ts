const TECHNICAL_DETAIL_PATTERN = /api\s*key|endpoint|bot\s*id|request\s*id|task\s*id|http\s*\d{3}|unauthorized|provider|环境变量|admin_emails|原始信息|响应体|返回格式|json|模型名未配置|鉴权失败|认证失败|无权限.*模型|invalidendpoint|not.?found.*model/i

const NETWORK_PATTERN = /failed to fetch|fetch failed|load failed|networkerror|网络连接|连接失败|socket|econn|gateway|网关/i
const TIMEOUT_PATTERN = /timeout|timed out|时间过长|超时/i
const BUSY_PATTERN = /rate.?limit|too many requests|429|限流|繁忙|并发/i

export type UserFacingErrorOptions = {
  fallback?: string
  status?: number
  subject?: string
}

/** Convert internal service errors into short messages that are safe for product UI. */
export function toUserFacingError(
  error: unknown,
  options: UserFacingErrorOptions = {},
): string {
  const fallback = options.fallback || "操作未完成，请稍后重试。"
  const subject = options.subject || "该功能"
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""

  if (options.status === 401 || /^unauthorized$/i.test(message.trim())) {
    return "登录状态已失效，请重新登录。"
  }
  if (options.status === 403 && /insufficient credits/i.test(message)) {
    return "积分不足，请先充值后再试。"
  }
  if (options.status === 403) return "当前账号没有执行此操作的权限。"
  if (options.status === 404) return "没有找到相关内容，请刷新后重试。"
  if (options.status === 413) return "本次提交的内容过大，请减少内容后重试。"
  if (options.status === 429 || BUSY_PATTERN.test(message)) {
    return "当前使用人数较多，系统会稍后继续，请不要重复提交。"
  }
  if ([502, 503, 504].includes(options.status || 0) || TIMEOUT_PATTERN.test(message)) {
    return `${subject}处理时间较长，请稍后查看结果或重新尝试。`
  }
  if (NETWORK_PATTERN.test(message)) {
    return "网络连接不稳定，请检查网络后重试。"
  }
  if (/未返回数据|数据不完整|结果不完整|解析失败|无法解析/i.test(message)) {
    return `${subject}结果不完整，请重新尝试。`
  }
  if (TECHNICAL_DETAIL_PATTERN.test(message)) {
    return `${subject}暂时不可用，请稍后再试或联系管理员。`
  }

  return message.trim() || fallback
}
