# 势途 GEO 桌面端

桌面端使用 Electron 承载线上势途 GEO 工作台。登录、客户数据、积分、AI 调用、长任务和历史报告仍以 ECS 服务端为唯一数据源，因此网页版和桌面版会始终使用同一份结果。

## 安全边界

- 远程页面始终使用 `nodeIntegration: false`、`contextIsolation: true` 和渲染进程沙箱。
- 桌面端只允许 `https://shitugeo.top` 与开发环境的 localhost 在主窗口内导航。
- 预加载脚本只暴露系统通知、桌面中心、网络诊断和页面导航等经过参数校验的小范围接口。
- API Key、支付密钥、数据库密码与队列凭证不打包进客户端。
- 外部付款或帮助链接使用系统浏览器打开，可执行协议与带账号密码的 URL 会被拒绝。

## 本地开发

先启动网页项目：

```bash
npm run dev
```

再启动桌面端：

```bash
npm --prefix desktop install
npm run desktop:dev
```

## 验证与打包

```bash
npm run desktop:test
npm run desktop:test:smoke
npm run desktop:build:mac
npm run desktop:build:win
```

macOS 本地内测包可以在当前 Mac 上生成。Windows x64 安装包由 GitHub Actions 的 Windows 机器生成，避免在 Mac 上引入 Wine 环境。对外分发前应配置 Windows 代码签名证书与 Apple Developer ID，内部测试可先使用未公证安装包。

## 发布

`electron-builder` 已配置 GitHub Releases 作为桌面端更新源。当发布 `desktop-v*` 标签时，桌面发布工作流会生成 Windows x64 和 macOS 安装包并附加到对应 Release。
