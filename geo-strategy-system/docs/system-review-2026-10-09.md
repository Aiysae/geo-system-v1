# 系统审查与修复记录

日期：2026-10-09；基线 HEAD：`4f62a06b`（分支 `commercial/mvp-billing`）。

## 范围

审查鉴权与会话、内部服务调用、限流、外部网页读取（SSRF）、支付回调、积分结算、后台任务恢复、前端轮询和测试隔离。本轮没有访问生产环境、没有触发付费模型调用，也没有修改文章生成质量规则（历史评测的通过率问题需另行复现，见 `uncommitted-change-plan-2026-09-29.md`）。

## 安全

| 问题 | 影响 | 修复 |
| --- | --- | --- |
| 限流取 `X-Forwarded-For` 最左项 | 该项由客户端控制，伪造即可绕过登录、注册、验证码的按 IP 限流 | 优先 nginx 写入的 `X-Real-IP`，其次取代理追加的最右项（`src/lib/rate-limit.ts`） |
| 会话签名密钥可回退到 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | 公开值会下发到浏览器，不能作为 HMAC 密钥 | 删除该回退（`src/lib/session-cookie.ts`） |
| 内部 API 令牌是固定 HMAC，用户由另一个请求头指定 | 令牌一旦泄露（日志、抓包），可永久冒充任意用户并绕过积分 | 令牌改为 `v2.<过期时间>.<签名>`，签名覆盖 scope、用户和过期时间，有效期 5 分钟（`src/lib/internal-api.ts`） |
| 网页读取先校验 DNS、再由 fetch 重新解析 | DNS 重绑定可在校验后改指向 `127.0.0.1` 或云元数据地址 `100.100.100.200` | 连接改用校验过的解析结果（`http(s).request` + 自定义 `lookup`），并补充 NAT64、6to4、`::/8`、site-local 及文档网段（`src/lib/safe-web-fetch.ts`） |
| 登录后跳转只拦截 `//` | `/\evil.com` 会被浏览器规范成 `//evil.com`，形成开放跳转 | 以固定 origin 解析后比对（`src/components/auth/local-auth-form.tsx`） |
| 无全局安全响应头 | 账户、充值、管理页可被第三方站点嵌入（点击劫持） | `next.config.ts` 增加 `X-Frame-Options: SAMEORIGIN`、`nosniff`、`Referrer-Policy`、`Permissions-Policy`，关闭 `X-Powered-By` |
| 未注册邮箱登录立即返回；停用账号无需密码即可确认状态 | 可按响应时间或提示枚举账号 | 未知邮箱也执行一次 scrypt；先校验密码再提示停用 |
| 重置链接先改密码后删令牌 | 并发提交可重复使用同一链接 | 以删除令牌作为单次使用的原子领取 |
| 支付宝回调在验签前写入事件表；非表单请求抛 500 | 未认证请求可持续写库 | 验签通过后才落库；解析失败返回 400 |

## 积分与数据一致性

- **积分重复退回**：后台任务、渗透率检测、难度评估的结算锁原为进程内 `Set`。web 进程（用户取消）和 worker 进程（任务中止）可同时结算，都读到“未结算”而重复退款。改为共享的 KV 锁 `acquireJobSettlementLock`（`src/lib/distributed-concurrency.ts`），获锁后重读任务状态。报告任务已用幂等退款号，未改动。
- **发布任务反馈不一致**（BACKLOG 项）：先写入客户可见的“已完成”动作，再完成任务；后者失败时动作残留。现在失败会恢复原动作或删除新动作；若并发提交已成功完成同一任务，则保留其动作。
- **注册邮箱被锁死**：邮箱占位成功但用户记录写入失败时，释放占位。

## 稳定性与性能

- 启动恢复（web `instrumentation.ts` 与 worker）改为按任务类型独立执行，任一类型失败只记录日志；各 `resumePending*` 循环逐项隔离。此前 worker 中任一失败会退出进程，PM2 重启后再次失败，导致所有队列停摆。
- 前端 `apiFetch` 每次成功都会刷新余额；任务页每 2.5–3 秒轮询，导致 `/api/credits` 请求量翻倍。GET 触发的刷新限制为 10 秒一次，写操作仍立即刷新。
- 旧版 `/api/generate`（前端已无调用）在读取响应体前清除了超时，响应体卡住时请求不会结束；解析失败返回 200。已修正超时与状态码。
- 限流的内存兜底桶设置上限并清理过期项。

## 测试与工程

- `scripts/run-all-tests.mjs` 为每个测试预设临时目录下的存储路径。此前 `test-agent-api`、`test-article-batches` 等会写入开发者本地 `.data/system-outputs.json`（本地文件中 `client-agent-test`、`article-batch-owner` 开头的记录即来自测试，可自行清理）。
- 新增 `scripts/test-request-security.mts`：客户端 IP、内部令牌的 scope／用户／过期绑定、保留地址拦截、结算锁互斥。
- `test-publishing-plan.mts` 增加任务存储拒绝时的回滚场景及并发提交场景；回滚场景在移除修复后会失败。
- ESLint 允许以 `_` 前缀标记有意不用的解构变量，原有 4 条警告清零。

## 部署注意

1. web 与 worker 必须同版本发布（`pm2 startOrReload ecosystem.config.cjs --update-env`）。内部令牌格式升级为 v2，新旧进程混跑期间内部请求会被拒绝，后台任务按原有重试逻辑恢复。
2. 生产环境必须设置 `AUTH_SECRET`（或 `SESSION_SECRET`）。若此前只依赖已删除的公开密钥回退，启动后会报 `AUTH_SECRET is not configured`。
3. nginx 需保持 `proxy_set_header X-Real-IP $remote_addr;`（`deploy/nginx/geo.conf.example` 已包含）。

## 验证

- `tsc --noEmit` 通过；`eslint src scripts cli` 0 错误 0 警告。
- `npm test`：109 项，108 通过、0 失败、1 跳过（桌面下载 UI，需运行中的应用与 Chromium，与基线相同）。基线为 108 项、107 通过；新增 1 项即 `test-request-security`。运行前后 `.data/` 文件的修改时间与大小完全一致。
- `npm run build` 成功；`next start` 实测页面返回上述安全响应头、不再返回 `X-Powered-By`，未登录访问 `/api/me` 返回 401。
- 真实网络验证网页读取：HTTPS、HTTP→HTTPS 跳转、gzip、brotli、多次跳转、404、取消、超时、大小上限均符合预期；`127.0.0.1`、映射/NAT64/6to4 形式的回环地址、云元数据地址、解析到回环的域名均被拒绝。
