export function shouldFailOverAiCredential(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "")
  return /(400|401|402|403|404|408|425|429|500|502|503|504|invalid.*key|unauthorized|forbidden|payment required|insufficient|model.*(?:not found|unavailable)|not found|timeout|timed out|超时|连接失败|fetch failed|network|socket|temporar|余额不足|欠费|无权限|模型不存在|返回空内容)/i.test(message)
}

export function isPermanentAiCredentialFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "")
  return /(401|402|403|invalid.*key|unauthorized|forbidden|payment required|insufficient.*(?:balance|credit)|余额不足|欠费|ToolNotOpen|tool.*not.*open|web search is not activated|联网搜索(?:服务|插件)?.{0,8}(?:未开通|未启用)|未开通.*联网搜索|无权限)/i.test(message)
}
