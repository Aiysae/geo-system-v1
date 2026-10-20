# 未提交改动盘点与拆分方案

日期：2026-09-29；基线 HEAD：`f3b76269`。

## 范围与结论

本轮只读取差异、调用关系、相关测试和历史实施记录，新增本方案；没有修改业务代码、拆分暂存或提交，也没有重新运行测试、访问生产或触发付费模型调用。

盘点时 Git 根仓库有 32 个已跟踪文件变化，其中 GEO 项目文本文件 30 个，另有 2 个 `.DS_Store`。GEO 目录有 61 个未跟踪文件：3 个源码、1 个测试、6 份独立文档、7 个评测文件、10 个小程序文件、34 个课件素材／产物；同仓库 Humanizer 另有 4 个未跟踪 `.DS_Store`。

重要：历史记录记载文章修复与 Agent 参数修复已经发布，但尚未提交。该记录不是本轮线上核验结果。应保留这些差异，形成可追踪提交后核对生产版本，避免使用旧源码覆盖线上修复。

## 建议顺序及提交边界

### 1. Agent 文章类型参数校验

- 目的：无效 promptKey 在入口返回 400／INVALID_ARGUMENT／不可重试，避免变成 500 并被反复重试。
- 文件：`src/lib/agent/action-catalog.ts` 中新增枚举及三个 schema 的替换；`scripts/test-agent-api.mts` 新增断言；`docs/agent-cli-fix-2026-09-24.md`。
- 拆分点：action-catalog 顶部改用 background-job-definitions 的 import 属于第 6 组，本组保留 HEAD 的 import。
- 判断：边界清楚，可优先构造独立补丁；不需要等文章任务恢复改动。
- 验证：Agent API、CLI、MCP、动作覆盖检查；额外确认批次 basePayload 和 questionTasks 的无效类型也被拒绝。当前新增测试直接覆盖单篇入口，批次两个入口仍需核实覆盖。

### 2. OpenAI 兼容请求的超时与重试

- 文件：`src/lib/llm/openai-compat.ts`、`scripts/test-openai-compat-timeout.mts`、`scripts/test-article-stage-budget.mts`。
- 目的：收到响应头后继续约束正文读取时间和取消；仅在错误明确涉及 response_format／JSON 模式时触发兼容重试。
- 依赖：阶段总时限在 HEAD 已存在，本组不要求新增文章 checkpoint 或模块提取。
- 验证：成功／错误响应体迟迟不结束、父请求取消、兼容重试超时；补核对普通 400 不重试及明确 JSON 模式错误仍可重试。当前新增断言重点覆盖正文超时。
- 判断：适合独立验证后提交；响应体先缓冲再重建 Response，需确认现有调用仍按非流式消费，保持错误状态与响应头语义。

### 3. 凭据错误分类与切换规则

- 文件：`src/lib/ai-credential-errors.ts`、`src/lib/ai-credential-failure-classifier.ts`；`scripts/test-ai-cost-controls.mts` 顶部对应分类断言。
- 目的：请求参数错误和取消不切换账号；未开通模型按 model_unavailable 分类。
- 拆分点：test-ai-cost-controls 其余差异属于第 4、5 组，不能整文件提前提交。路由中的“模型尚未开通”用户提示可随本组提交，对应 mock 场景需一并抽取。
- 验证：400 参数错误、取消、欠费、429、未开通型号及普通暂时故障；核对共享函数在文章以外的调用处。运行凭据分类、路由及成本控制测试。
- 判断：这是共享行为修正，影响范围比文章单模块更广，需要独立回归。

### 4. 文章事实边界、质量判断与修复保稿

- 源码：新增 `src/lib/article-fact-rules.ts`；修改 `article-content-pipeline.ts`、`article-prompts.ts`、`article-quality.ts`、`article-web-context.ts`、`geo-article-prompts.ts`、`geo-methodology/compiler.ts`（均位于 src/lib）；以及 `src/app/api/article-generation/route.ts` 对应代码块。
- 测试：`test-article-content-pipeline.mts`、`test-article-quality.mts`、`test-geo-article-prompts.mts`，以及 `test-ai-cost-controls.mts` 的标题修正／劣质修复保留原稿场景。
- 目的：生成、审核、修复使用统一事实规则；避免对照资料重复进入 Prompt；只提升已有开头标题；修复变差时保留原稿。
- 行为变化：多个词面关联检查和未引用检索资料检查从 blocking 变成提示。这不是纯重构，验收必须包含真实无依据事实仍被阻断的场景。Prompt 哈希更新只验证版本一致，不能单独证明文章质量提高。
- 拆分点：路由中 checkpoint、等待错误和模型预检属于第 5 组；本组的修复稿质量比较与保存 checkpoint 相邻，需要按语义拆开。内容流水线版本改动在本组，后续恢复逻辑沿用该版本。
- 验证：上述测试＋文章方法论／改写测试；复核题意偏离与事实缺失的预期处理，不通过继续降低规则来制造通过率。

### 5. 文章线路等待、型号固定、断点恢复及草稿展示

- 源码：新增 `src/lib/article-checkpoint.ts`；`src/lib/ai-credential-router.ts`、`article-model-runtime.ts`、`background-jobs.ts`、`background-job-workspace-state.ts`、`article-batches/manager.ts`；`src/types/index.ts`；文章 route；`src/components/article/article-generation-module.tsx` 和 `article-batch-workspace.tsx`。
- 测试：`scripts/test-article-background-execution.mts`、`test-article-credential-pool.mts`；成本控制测试中剩余的线路状态断言。
- 目的：暂时故障延迟处理，欠费／权限问题明确失败；创建时固定型号；保存初稿／修复稿／审核结果；恢复时减少重复付费；界面保留未完成草稿。运行阶段计时日志也包含在本组。
- 依赖：建议在第 2—4 组之后处理。等待异常必须连同生产方、API 转换、worker 捕获、调度延迟一起提交；checkpoint 必须连同保存／恢复／对外过滤和展示一起验证。先作为一组完整生命周期改动，不拆出无法运行的中间提交。
- 拆分点：background-jobs 的定义提取属于第 6 组；本组沿用原 resolveTask／估价定义也可实施。
- 已有测试内容：草稿后中断恢复、取消、保存失败、冷却／恢复、等待超时、欠费、积分只结算一次、型号固定及无效型号不扣费。
- 提交前补核实：本地调度与持久队列两种路径、批次取消时草稿保留、并发恢复／中途再次繁忙、最终失败提示与实际原因一致。UI 用实际失败草稿检查展示与导出。
- 验收限制：历史评测记录 10 篇仅 2 篇通过系统审核，尚未达到批量可靠性验收；这是历史特定配置的结果，不是本轮测得的当前成功率。提交现有修复不代表这个问题已解决。容量排队与线路故障等待、已有初稿后续处理的饥饿问题应另设故障任务，先复现再改，避免继续堆重试。

### 6. 后台任务定义提取（可选，最后评估）

- 文件：新增 `src/lib/background-job-definitions.ts`、`scripts/test-background-job-definitions.mts`；`package.json` 的对应命令；background-jobs 的定义移出／重导出／resolveTask 替换；action-catalog 的单行 import。
- 目的：让动作目录读取估价和种类定义时减少对任务执行模块的直接依赖；保持旧导出可用。
- 判断：与第 5 组混在同一文件，但不是它的必要前置。规则基本原样搬迁，没有证据表明能提高生成成功率；待业务修复清晰后再决定是否保留。
- 验证：19 个已有估价案例、无效类型／Prompt、旧入口重导出、Agent 回归与类型检查；核对移动前后的边界行为一致。
- 简化原则：不再扩展注册器、插件接口或通用任务框架；若没有实际维护收益，可单独撤回这组，撤回时要同时处理上述引用和 npm 命令。

## 其他未跟踪内容

| 内容 | 归属与建议 |
| --- | --- |
| `wechat-miniprogram/` 10 个文件＋`.gitignore` 两行 | 独立小程序 web-view 项目，单独提交和验收；现有 README 仍要求 AppID、业务域名、真机登录／上传下载验证，不并入 GEO 重构 |
| 课件素材目录 34 个文件 | 课件脚本、来源记录与渲染产物，保持原位；如需归档，按课件任务单独处理，不能因为未跟踪就删除 |
| `docs/article-ai-call-audit-2026-09-22.md` | 第 2—5 组的问题依据；保留时间与证据边界 |
| `docs/article-ai-optimization-progress-2026-09-22.md`、`article-production-diagnosis-2026-09-23.md`、`article-repair-implementation-2026-09-23.md` | 第 2—5 组历史实施与生产记录，待相关改动完整提交后一起归档 |
| `docs/evaluations/` 7 个文件 | 10 篇历史实测报告、数据和 5 篇正文；先确认无敏感业务内容，再作为独立评测资料提交 |
| `docs/credit-pricing-proposal-2026-09-14.md` | 独立计价提案；不能当作当前价格或已批准变更，不并入代码修复 |
| 仓库与 Humanizer 的 `.DS_Store` | 桌面元数据，排除于业务提交，保留现状 |

## 执行办法与验证口径

1. 下一批先处理第 1 组，在干净源码副本按代码块构造补丁；验证后只暂存该组。原工作区其他差异保持原样。
2. 每组按依赖顺序验证、独立提交。共享文件不用整文件暂存；提交后再次核对剩余差异，防止误带或遗漏新文件。
3. 每组先跑相关测试与类型检查；合并相关组后跑统一 npm test。生命周期组涉及运行与界面，增加构建和对应人工界面验收；不自动追加付费生成实验。
4. 需要发布时，先比较生产源码／发布记录与已提交版本，再确定发布基线。本轮不部署。

此前 Phase 3 的全量 106 通过／1 跳过来自 HEAD 加发布计算重构的隔离副本，未包含这些未提交改动，不能作为它们各自可独立提交的证明。本轮完成的是静态盘点与拆分方案；以上验证项是后续每组提交的门槛。
