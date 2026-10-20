# 待处理事项

- **桌面安装 UI 的自动化测试环境**：这个测试需要运行中的应用和 Chromium，新 clone 后只跑 `npm ci` 不具备这些条件，所以默认跳过。之后单独准备界面测试环境。
- **轮换 humanizer 的旧 API Key**：`humanizer-app` 已改为从环境变量 `HUMANIZER_API_KEY` 读取密钥。旧密钥需要在服务商后台作废，换上新密钥后再实际调用验证一次。
