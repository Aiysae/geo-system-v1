const WEB_APP_URL = "https://shitugeo.top/workspace"

Page({
  data: {
    failed: false,
    webAppUrl: WEB_APP_URL,
  },

  handleLoad() {
    if (this.data.failed) {
      this.setData({ failed: false })
    }
  },

  handleError() {
    this.setData({ failed: true })
  },

  retry() {
    this.setData({ failed: false, webAppUrl: "" }, () => {
      this.setData({ webAppUrl: WEB_APP_URL })
    })
  },

  onShareAppMessage() {
    return {
      title: "势途 GEO · GEO 全链路操作工具",
      path: "/pages/index/index",
    }
  },
})
