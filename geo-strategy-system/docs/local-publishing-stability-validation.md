# 分发稳定性验收 · 2026-10-21

本次修改集中于登录状态回存、账号级暂停与冷却、跨批次提交预算，以及网页与执行器分离。测试只使用本地演示平台，未正式发布任何真实平台文章。

30 项自动化测试通过；完整界面流程分别在子进程模式和独立 socket 模式通过。工作区 TypeScript、所改前端文件 ESLint 通过。

## 已通过的验证

- 存储：登录失效暂停同账号所有批次；重新登录恢复；陈旧凭据写入被拒绝；退出账号不被后台任务重新激活。
- 调度：跨批次和重启共用提交间隔 / 滚动 24 小时额度，提交结果不明确仍占用额度；其他账号不受单账号异常影响。
- SDK：未修改的客户端适配器可连接隔离演示站；Cookie 轮换后下一次调用成功；401 与 403 分开；429 使用平台返回的等待时间。
- Cookie：域名、路径、主机专属、删除和 Max-Age 生效；保留未打开来源的浏览器存储。
- 独立服务：网页请求断开不停止执行器；限流期间强制终止并重启执行器，等待时间仍保留，随后自动完成草稿；网络恢复和重新登录均自动继续；没有重复草稿。
- 页面：嵌入式账号登录，验证暂停提示、请求限速与下次尝试、登录保存时间正常；验证恢复、重新登录后自动执行；完成 4 篇演示草稿；390px 宽度无整页溢出，无浏览器脚本错误。

验证命令：

```sh
node --test integrations/local-publisher/tests/*.test.cjs
npx tsc --noEmit
npx eslint src/lib/local-publishing/service.ts src/lib/local-publishing/types.ts src/components/publishing/publishing-console.tsx
python3 integrations/local-publisher/tests/stability-ui.py
```

页面测试依赖隔离预览进程 `node integrations/local-publisher/tests/preview.cjs`。截图和机器可读结果保存在本机 `.data/publishing-preview/evidence/stability/`，含演示账号名称，不纳入版本库。

## 尚需真实运行观察

真实平台的长期会话保留和偶发验证频率，需要有登录状态的账号进行 7–14 天低频草稿观察。本轮结果不代表所有平台长期可用，也不代表账号永不过期。正式发布功能的原有平台验证限制继续生效。

## 线上版本

已部署到 `https://shitugeo.top/publishing`，构建编号 `7Kv2wXTSZGh1yCOso5g6k`。线上页面确认显示独立服务和新增登录状态字段。`geo-publisher` 由 PM2 管理，网页重启前后执行器 PID 保持不变；socket 权限 0600。

上线前备份：`/var/backups/geo-publishing-20261021-stability-v3`（数据库和会话密钥）；旧代码保留在 `geo-strategy-system-pre-20261021-stability`。发布脚本曾因错误的健康检查路径触发回滚，已改用项目实际的 `/api/desktop/health` 并完成上线。线上未创建测试平台账号或分发任务。

构建基于上线前的线上代码，仅叠加本次文件。线上基底的 `scripts/test-penetration-provider-concurrency.mts` 存在一个与本次无关的类型缺项（`zhipu`）；未改动该测试。生产源码单独类型检查通过后，使用已有构建开关跳过重复的全库类型检查。当前工作区完整类型检查通过。

## 登录窗口自动释放补充验收

- 登录核验成功后自动保存并释放窗口，无需手动关闭；90 秒无画面请求时回收遗留窗口。窗口关闭或状态采集失败也释放账号占用，慢关闭不阻塞其他账号。
- 新增 5 项回归测试，先复现问题再修复；共 35 项自动化通过，工作区 TypeScript 与修改文件 ESLint 通过。
- 页面回归完成 5 篇本地演示草稿：成功后自动关闭、平台验证恢复、限流恢复、过期后重新登录恢复；关闭整个浏览器后草稿继续完成，重开后保留账号状态；刷新遗留窗口在 90 秒阈值后释放。无页面脚本错误，390px 布局通过。
- 对本地既存 CSDN 凭据仅做身份查询，查询成功且与绑定账号一致；未写入真实平台文章。线上账号列表为空，该本地凭据没有自动迁移到线上。
- 发布基于新的线上基底 `2cQPMDk_zXSkojAyktDcj`，只叠加窗口生命周期、页面完成提示和文档。线上基底仍有上述无关测试脚本的类型缺项；生产源码单独类型检查通过。
- 补充版本已上线，构建编号 `222VkAcFfGo__mUl-yi8z`。线上执行器与网站健康检查通过；实际页面显示“执行器已连接”和“独立服务 · 网页重启不中断队列”。数据及源文件备份位于 `/var/backups/geo-publishing-20261021-login-window`；旧构建保留在应用父目录的 `.next-pre-20261021-login-window`。线上账号与任务仍为空。
