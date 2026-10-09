const retryButton = document.querySelector("#retry-button")
const status = document.querySelector("#offline-status")

retryButton.addEventListener("click", async () => {
  retryButton.disabled = true
  retryButton.textContent = "正在连接"
  status.textContent = ""
  try {
    const connected = await window.shituDesktop.retryApplication()
    if (!connected) {
      status.textContent = "仍未连接成功，请稍后重试或运行网络诊断。"
    }
  } catch {
    status.textContent = "重连未完成，请检查网络后再试。"
  } finally {
    retryButton.disabled = false
    retryButton.textContent = "重新连接"
  }
})
