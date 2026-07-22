import assert from "node:assert/strict"

const errorModule = await import("../src/lib/user-facing-errors") as typeof import("../src/lib/user-facing-errors") & {
  default?: typeof import("../src/lib/user-facing-errors")
}
const { toUserFacingError } = errorModule.default || errorModule

assert.equal(
  toUserFacingError("Missing API Key: secret-value", { subject: "文章创作" }),
  "文章创作暂时不可用，请稍后再试或联系管理员。",
)
assert.equal(
  toUserFacingError("Unauthorized", { status: 401 }),
  "登录状态已失效，请重新登录。",
)
assert.equal(
  toUserFacingError("Insufficient credits", { status: 403 }),
  "积分不足，请先充值后再试。",
)
assert.equal(
  toUserFacingError("Gateway timeout", { status: 504, subject: "疑问句检测" }),
  "疑问句检测处理时间较长，请稍后查看结果或重新尝试。",
)
assert.equal(
  toUserFacingError(new TypeError("Failed to fetch"), { subject: "客户报告" }),
  "网络连接不稳定，请检查网络后重试。",
)
assert.equal(
  toUserFacingError("文章结果不完整", { subject: "文章生成" }),
  "文章生成结果不完整，请重新尝试。",
)
assert.equal(
  toUserFacingError("邮箱验证码不正确", { fallback: "验证码验证失败。" }),
  "邮箱验证码不正确",
)
assert.ok(!toUserFacingError("HTTP 500: token=secret").includes("secret"))

console.log("User-facing error tests passed.")
