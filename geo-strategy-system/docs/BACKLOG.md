# 待处理事项

- **发布任务与客户反馈一致性**：前轮审阅发现 `src/lib/publishing-plan/task-service.ts` 先写完成反馈，再完成发布任务；后一操作失败会产生不一致。属于业务缺陷，需独立修复与故障回归，不混入 Phase 1。
- **桌面安装 UI 的自动验收环境**：目前脚本需要运行中的应用与 Chromium，全新 clone 加 npm ci 尚不具备这些条件。Phase 1 明确列为默认 SKIP；后续单独准备界面测试环境。
- **密钥历史审计与处置**：Phase 2 审计已完成，见 [脱敏报告](secret-history-audit-2026-09-28.md)。`humanizer-app` 中发现 1 项硬编码 API 凭据，需要核实撤销状态或轮换；实际处置尚未执行。
