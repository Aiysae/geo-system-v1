# 势途 GEO 微信小程序

这是一个最小微信小程序壳，通过 `web-view` 复用已经上线的
`https://shitugeo.top/workspace`。现有 Next.js 登录、工作台、API 与数据存储保持不变。

## 首次导入

1. 在已认证服务号后台复用主体资质，快速注册并认证一个“小程序”账号。
2. 取得该小程序自己的 AppID；服务号 AppID 不能代替小程序 AppID。
3. 在微信开发者工具中导入本目录，将 AppID 从 `touristappid` 改为小程序 AppID。
4. 在小程序后台的开发设置中，把 `https://shitugeo.top` 配置为业务域名。
5. 若微信要求域名校验文件，把下载的校验文件原样放到主站 `public/` 根目录，部署后确认可通过
   `https://shitugeo.top/文件名` 访问，再完成域名校验。
6. 使用真机验证登录、工作台、文件上传与下载，然后上传体验版并提交审核。

## 上线范围

- 第一版复用现有邮箱账号和 HttpOnly Session。
- 第一版不在小程序内发起微信支付；现有系统只有 Native/H5 支付，小程序内闭环支付需要另接
  `wx.login`、openid、JSAPI/小程序下单和 `wx.requestPayment`。
- `project.private.config.json` 和小程序 CI 私钥不会提交到 Git。
