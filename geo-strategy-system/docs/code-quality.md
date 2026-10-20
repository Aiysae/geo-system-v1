# 测试与 CI

## 运行

```bash
npm ci
npm test
```

`scripts/run-all-tests.mjs` 会自动发现 `scripts/` 顶层的 `test-*.mts`、`test-*.mjs`、`test-*.ts`、`test-*.js`，按文件名顺序执行。每个文件通过 package.json 里对应的 npm 命令启动，所以 `NODE_OPTIONS`、`NODE_ENV` 等参数都在那里配置。

- 单项失败不会中断后续测试，最后汇总总数、通过、失败、跳过，以及失败和跳过的清单。有失败或一个测试都没找到时退出码为 1。
- 新增测试必须在 package.json 里有且只有一个对应命令，否则计为失败，防止漏测。
- 每个测试默认使用临时目录下的存储路径，不会写入本地 `.data/`；测试自己指定的路径优先。

## 默认跳过的测试

`test-desktop-download-ui.mjs` 需要运行中的应用和 Playwright Chromium，默认跳过。准备好之后这样运行：

```bash
SHITU_UI_TEST_URL=http://127.0.0.1:3000 npm test
```

指定了 URL 后，连接或浏览器出错会算作失败，不再跳过。

## 不在 npm test 里的检查

- `smoke:*`、`stress:*` 会调用真实模型，需要单独运行。
- `desktop/` 有自己的测试命令：`npm run desktop:test`。
- 分发执行器的测试见 `integrations/local-publisher/README.md`。

普通测试使用模拟响应和隔离存储，不读取生产环境配置。

## CI

PR 检查和部署流程都会先运行 `npx tsc --noEmit` 和 `npm test`，任何一项失败都会阻止部署。CI 使用 Node.js 20。
