# 势途 GEO 本机独立分发

入口：`https://shitugeo.top/publishing`。登录势途 GEO 后可从工作台侧栏进入中文分发台；文章排版的发布面板可“加入独立分发台”。

## 已实现

- GEO 登录权限下的账号、文章、任务及事件记录；不同 GEO 用户按 owner 隔离。
- 每个媒体账号一个 Playwright BrowserContext，在 GEO 页面内操作截图、输入、扫码与平台验证码。
- SQLite WAL 持久化；Cookie、localStorage、IndexedDB、sessionStorage 经 AES-256-GCM 加密保存。密钥文件与数据库默认权限 0600，目录 0700。
- 账号 × 文章批次、立即或定时执行、平台草稿或发布、暂停/恢复、取消等待任务。
- 同一账号串行、全局最多 5 个任务并发；批次请求键防止重复点击，任务保存提交时文章版本。
- 发布前检查账号身份；登录失效等待重新登录，完成后自动继续。发布前连接失败和限流采用有限次数退避重试。
- 提交后的审核轮询；有平台编号的任务恢复时只核验，不重新发布。
- 执行器进程退出后由 GEO 服务自动重启；租约到期后恢复尚未提交的任务。正在提交且结果不明确的任务进入“待核对”。
- 本机内容库现可保存文章、视频、图文笔记、音频、公众号 1–8 篇内容包及短动态；图片、MP4、MP3/WAV/M4A 文件按 GEO 用户隔离存入本机素材库。原 GEO 配图可按素材编号导入。
- 账号分组、逐账号标题/摘要/封面差异、分发方案暂存与复制编排、同账号发布间隔及每日上限已接入页面。创建任务前按账号×内容类型逐项预检；未接入的草稿类型被拦截，不会降级为私密或正式发布。
- 携程笔记（图文）与掘金（文章）加入独立草稿试存适配：网页填写后须从平台草稿箱回读内容才计为成功。美篇只接入登录与身份核验；普通草稿仅存浏览器本地，云端草稿涉及会员状态，暂不进入持久任务队列。三者都未做实号登录与草稿验收，页面明确标记待验证，正式发布统一拦截。
- 本地演示账号支持上述五种新增内容类型的模拟草稿入队与回执；现有真实平台中仅 CSDN 文字文章草稿已通过实号验证。
- SDK 内部写请求断网或返回 5xx 后，停止该执行进程的后续 HTTP 写入，防止其内部重试重复提交；用户可在页面补充平台文章编号核验，或确认未产生文章/草稿后重试。

## 代码边界

`vendor/platform-service.cjs` 原样复制自先前提取的蚁小二客户端平台更新模块，版本线索 4.13.11。来源及 SHA256 见 `vendor/provenance.json`。多媒体客户端模块另存为 `vendor/multimedia-platform-service.cjs`，来源见 `vendor/multimedia-provenance.json`；旧版已验证的文章模块没有被覆盖。没有取得蚁小二服务器源码。

`platform-service.cjs`、`multimedia-platform-service.cjs`、`login-detectors.cjs` 三个提取文件不进入版本库，需在每台执行分发的主机上单独放入 `vendor/`，并按 provenance 文件核对 SHA256。部署脚本同步源码时会保留服务器上已有的这三个文件。

复用的是文章适配分支、字段转换、平台用户查询、发布与审核调用、本地回调，以及 3 个已有登录响应识别器。所有 24 个明确的文章分支都通过同一执行入口注册；其余平台登录通过定期调用原 SDK 用户查询确认。

GEO 自己实现账号库、加密会话、文章库、批次、调度、租约恢复、操作页面、本地演示服务。SDK 在单独子进程执行，不转发 GEO/模型/生产数据库凭据，禁用其进程执行入口。SDK 的进度/审核回调指向受随机令牌保护的本机临时接口。普通 HTTP/HTTPS/fetch 对蚁小二域名的请求被阻止；发现专用服务依赖时显示“存在远端依赖”，不计为发布成功。此进程隔离不是操作系统沙箱。

**真实平台均需实号验证。** 接入原客户端代码不代表平台当前接口仍然可用。页面区分代码接入、登录验证、草稿验证、发布验证、远端依赖。需要其他必填参数、平台签名服务、上传适配、公众号发布二次扫码等情况须按平台逐项补齐；本次没有向真实内容平台发布。

新增三个平台的账号可在页面先添加、稍后登录。携程、掘金的草稿执行只在显式创建批次并登录后发生；美篇草稿被预检拦截。携程官方入口为 `we.ctrip.com` 内容中心，掘金为 `juejin.cn/editor/drafts`，美篇为 `meipian.cn`；对应实现位于 `platform-adapters/`，没有写入蚁小二客户端原始 SDK 文件。

## 演示平台

“本地演示平台”使用独立 `demo-platform.sqlite`，API 形状与原 CSDN 适配器一致。原 SDK 实际运行，域名请求在该专用账号执行进程内重定向至 loopback。真实平台账号不会使用此重定向。演示页始终明确标注“本地演示”。

页面可模拟登录过期、12 秒限流、提交后持续断网、恢复接口，并查看演示平台收到的文章。任意 2–40 位字母、数字、下划线、连字符用户名，密码 `demo1234`。这只是模拟平台固定测试凭据。

文章演示运行原 CSDN 适配器；视频、图文、音频、公众号包和短动态演示写入本机模拟平台，验证本机素材、预检、队列和回执，不代表真实平台上传能力。

## 本地运行与存储

- 分发执行器需要 Node.js >= 22.13（本次使用 24.14.0），依赖由项目 package-lock 锁定。GEO Web 若仍使用 Node 20，可设置 `LOCAL_PUBLISHER_NODE=/absolute/path/to/node24`，仅让分发执行器使用该 Node；未设置时沿用 Web 的 Node。路径须为生产主机上可执行的绝对路径。
- Playwright 为运行时依赖。本次浏览器安装在项目 `.data/local-publishing-browsers/`，启动器会自动识别，也支持 `LOCAL_PUBLISHER_BROWSER` 指定浏览器路径。
- 正常 GEO 开发运行时自动启动分发服务，默认数据目录 `.data/local-publishing/`；生产环境须将 `LOCAL_PUBLISHER_DATA_DIR` 设为代码发布目录之外、仅应用用户可读写的持久目录（例如 `/var/lib/geo-system/local-publishing`），避免发布或回滚时清空账号、任务和素材。
- 本次隔离验收入口 `http://127.0.0.1:18860/publishing`，数据 `.data/publishing-preview/`，与已有 GEO 数据库分开。
- 验收用 GEO 账号 `publishing-demo@local.test`，密码 `LocalDemo2026!`，只用于本机隔离环境。已在当前浏览器登录。
- 生产模式默认关闭，只有 `GEO_LOCAL_PUBLISHING=1` 才启用。线上 ECS 已启用，并将数据持久化在 `/var/lib/geo-system/local-publishing/`；Web 进程由 PM2 管理。
- 本地预览仍依赖本机和外置硬盘；线上分发依赖 ECS 和对应的 GEO Web 进程持续运行。
- 备份需要保存 SQLite 一致性快照、`session.key` 和素材文件；数据库启用了 WAL，运行中直接复制单个 `publishing.sqlite` 可能遗漏尚在 WAL 中的记录。密钥丢失后账号需要重新登录；勿把运行数据库、Cookie 或密钥纳入源码提交。

开发者检查命令（正常使用在页面完成）：

```sh
node --test integrations/local-publisher/tests/store.test.cjs
node --test integrations/local-publisher/tests/multimedia.test.cjs
node --test integrations/local-publisher/tests/ctrip-adapter.test.cjs integrations/local-publisher/tests/meipian.test.cjs integrations/local-publisher/tests/juejin.test.cjs integrations/local-publisher/tests/new-platforms.test.cjs
node integrations/local-publisher/tests/preview.cjs
python3 integrations/local-publisher/tests/ui-smoke.py
python3 integrations/local-publisher/tests/recovery.py
npx tsc --noEmit
npm run test:article-publishing
```

测试脚本只连接本机演示环境。`preview.cjs` 清空已有 .env 凭据来源、显式指定独立文件存储，再启动 Next 本地服务；不连接现有生产数据库。
