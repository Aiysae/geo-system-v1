# Phase 2：密钥历史审计

日期：2026-09-28

## 结论

Gitleaks 共命中 **4 处**：**1 项硬编码 API 凭据风险，1 项测试专用值，2 项第三方源码映射误报**。

建议优先轮换 `humanizer-app/app.py` 中的 API Key；若已撤销，需凭供应商后台记录确认。该值仍存在于当前 HEAD 和两个远程分支的当前文件中，并实际传入 OpenAI 客户端。**有效性待确认**，本次未调用供应商 API，也没有取得后台撤销记录。这里确认的是凭据进入 Git 的事实，并不代表已确认外部人员使用过该凭据。

本次默认规则扫描在 `geo-strategy-system/` 内仅发现测试专用值；这不等同于证明不存在其他泄漏。

## 扫描范围与方法

- Git 根目录为 `Cursor—GEO`，覆盖整个仓库，包含 `geo-strategy-system` 和 `humanizer-app`。
- 扫描前 `git fetch --all --tags` 成功；仓库不是浅克隆。远端公开给当前账号的两个分支与一个标签已通过 `git ls-remote --heads --tags origin` 核对。
- 扫描起点 HEAD：`08b8542fe51019320eabbfea383d44a44e8815d6`。
- 本地分支：`commercial/mvp-billing`、`main`；远程分支：`origin/commercial/mvp-billing`、`origin/main`；标签：`desktop-v1.0.0`。`--all` 同时包含本地 Codex 引用。
- 共扫描 **275 个可达提交**，约 **157.10 MB**；工具退出码 **1** 表示发现命中，扫描正常完成。
- 工具：Gitleaks **8.30.1**，官方 Darwin ARM64 发布包，已核对官方发布的 SHA-256 校验和。工具安装在仓库外临时目录，项目依赖保持原样。
- 使用默认检测规则，空的忽略文件路径，忽略 `gitleaks:allow` 注释；没有新增白名单。报告全量脱敏。

等效命令（CONFIG 仅包含 `[extend]` 和 `useDefault = true`）：

```sh
gitleaks git REPO --log-opts='--all --full-history -m'   --config CONFIG --gitleaks-ignore-path EMPTY_IGNORE_PATH   --ignore-gitleaks-allow --redact=100   --report-format=json --report-path REPORT --no-banner --no-color
```

工具说明：[Gitleaks 官方文档](https://github.com/gitleaks/gitleaks)。

覆盖限制：不包含远端已删除且本地不可达的提交、服务端未公开的引用、未提交工作区及本地环境文件；未展开历史中的压缩包。本报告结论限于上述可达历史和默认规则可识别的内容。

## 逐项核实

所有命中的规则均为 `generic-api-key`。行号对应命中提交中的文件。

| 编号 | 文件与行号 | 所在提交 | 判断与证据 | 有效性／处置 |
| --- | --- | --- | --- | --- |
| A1 | `humanizer-app/app.py:10` | `3a15a83fc3810689ca3f1b9a245fa12cebb3d30a` | `API_KEY` 为非示例形式的硬编码值，传入 `OpenAI(api_key=API_KEY, ...)`；服务地址配置为 `https://api.b.ai/v1` | 待确认；建议优先轮换或核实已撤销 |
| A2 | `geo-strategy-system/scripts/test-penetration-v3-scheduling.mts:10` | `4f22e0455e6a62ca870a304d5e8be3e5239d8a39` | 测试设置的 `AI_CONFIG_ENCRYPTION_KEY`；脚本使用临时目录、本地 KV 和构造的测试凭据；当前 HEAD 同值仅出现于此测试 | 测试专用值，无生产有效性证据；无需因本次命中轮换 |
| A3 | `humanizer-app/venv/share/jupyter/nbextensions/pydeck/index.js.map:6` | `3a15a83fc3810689ca3f1b9a245fa12cebb3d30a` | 命中源码映射 names 数组中的 `GLTFV1Normalizer`，对应 GLTF 标准化类名 | 误报，不是凭据 |
| A4 | 同 A3 | 同 A3 | 命中源码映射 names 数组中的普通 JavaScript 标识符，处于 token 处理函数名附近 | 误报，不是凭据 |

A1 的 SHA-256 前 12 位：`8d7b8a65ee70`，仅用于本地核对同一凭据，报告不保留凭据原文。当前 HEAD 中仅 `humanizer-app/app.py` 包含该值；`origin/main`、`origin/commercial/mvp-billing` 对应文件也仍包含该值。

## 建议处置顺序（本阶段尚未执行）

1. 在供应商后台定位 A1 对应凭据，确认撤销状态及使用记录；已撤销则记录证据，否则按泄漏凭据处理。
2. 若应用仍使用它，创建替代凭据，另行把应用读取方式调整为环境变量或现有密钥配置，更新部署配置并验证一次正常请求。新凭据只进入配置存储。
3. 撤销旧凭据并确认状态；若发现异常调用，应优先立即撤销旧凭据。
4. 清除当前代码中的硬编码旧值，单独提交。历史重写另行评估；删除当前文件里的值不能替代撤销。

## 本阶段交付边界

本次仅新增审计报告并更新待办状态。业务源码、依赖、部署配置和既有 Git 历史均保持原样；没有执行密钥轮换或推送。
