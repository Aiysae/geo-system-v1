let state = null
let activeTab = new URLSearchParams(window.location.search).get("tab") || "downloads"

const formatBytes = value => {
  const bytes = Math.max(0, Number(value) || 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

const statusLabel = status => ({
  choosing: "等待选择保存位置",
  progressing: "正在下载",
  completed: "已完成",
  cancelled: "已取消",
  interrupted: "已中断",
}[status] || status)

function selectTab(tab) {
  const allowed = new Set(["downloads", "network", "settings", "updates"])
  activeTab = allowed.has(tab) ? tab : "downloads"
  document.querySelectorAll("[data-tab]").forEach(button => {
    button.setAttribute("aria-selected", String(button.dataset.tab === activeTab))
  })
  document.querySelectorAll("[data-panel]").forEach(panel => {
    panel.hidden = panel.dataset.panel !== activeTab
  })
}

function renderSettings() {
  if (!state) return
  document.querySelectorAll("[data-setting]").forEach(group => {
    const key = group.dataset.setting
    group.querySelectorAll("[data-value]").forEach(button => {
      button.classList.toggle("active", state.settings?.[key] === button.dataset.value)
    })
  })
}

function renderDownloads() {
  const container = document.querySelector("#download-list")
  container.replaceChildren()
  const downloads = state?.downloads || []
  if (downloads.length === 0) {
    const empty = document.createElement("div")
    empty.className = "empty-state"
    empty.textContent = "暂无下载记录"
    container.append(empty)
    return
  }

  for (const download of downloads) {
    const item = document.createElement("article")
    item.className = "download-item"

    const description = document.createElement("div")
    const name = document.createElement("div")
    name.className = "download-name"
    name.textContent = download.filename
    name.title = download.filename
    const meta = document.createElement("div")
    meta.className = "download-meta"
    const progress = download.totalBytes > 0
      ? Math.min(100, Math.round(download.receivedBytes / download.totalBytes * 100))
      : 0
    meta.textContent = `${statusLabel(download.status)} · ${formatBytes(download.receivedBytes)}${download.totalBytes ? ` / ${formatBytes(download.totalBytes)}` : ""}`
    description.append(name, meta)

    const actions = document.createElement("div")
    actions.className = "download-actions"
    if (download.status === "completed") {
      const open = document.createElement("button")
      open.type = "button"
      open.className = "text-button"
      open.textContent = "在文件夹中显示"
      open.addEventListener("click", () => window.shituDesktopCenter.openDownload(download.id))
      actions.append(open)
    }
    if (["choosing", "progressing"].includes(download.status)) {
      const cancel = document.createElement("button")
      cancel.type = "button"
      cancel.className = "text-button danger"
      cancel.textContent = "取消"
      cancel.addEventListener("click", () => window.shituDesktopCenter.cancelDownload(download.id))
      actions.append(cancel)
    }

    const track = document.createElement("progress")
    track.className = "progress-track"
    track.max = 100
    track.value = download.status === "completed" ? 100 : progress
    item.append(description, actions, track)
    container.append(item)
  }
}

function diagnosticItem(label, value, detail, ok) {
  const item = document.createElement("article")
  item.className = "diagnostic-item"
  const labelNode = document.createElement("div")
  labelNode.className = "diagnostic-label"
  labelNode.textContent = label
  const valueNode = document.createElement("div")
  valueNode.className = `diagnostic-value ${ok ? "status-good" : "status-bad"}`
  valueNode.textContent = value
  const detailNode = document.createElement("div")
  detailNode.className = "diagnostic-detail"
  detailNode.textContent = detail
  item.append(labelNode, valueNode, detailNode)
  return item
}

function renderDiagnostics(result) {
  const container = document.querySelector("#diagnostic-grid")
  container.replaceChildren(
    diagnosticItem("DNS", result.dns.ok ? "解析正常" : "解析异常", `${result.dns.latencyMs} ms · ${result.dns.address}`, result.dns.ok),
    diagnosticItem("系统代理", result.proxy.ok ? "检测完成" : "检测异常", `${result.proxy.latencyMs} ms · ${result.proxy.value}`, result.proxy.ok),
    diagnosticItem("势途 GEO 服务", result.service.ok ? "连接正常" : "连接失败", `${result.service.latencyMs} ms · ${result.service.message}`, result.service.ok),
  )
}

function renderUpdate() {
  const update = state?.update || {}
  const labels = {
    checking: "正在检查",
    downloading: "正在下载",
    ready: "新版本已就绪",
    error: "更新检查未完成",
    current: "当前已是最新版本",
    development: "当前为开发版",
    idle: "检查客户端版本",
  }
  document.querySelector("#update-title").textContent = labels[update.status] || labels.idle
  document.querySelector("#update-message").textContent = update.message || "当前已是最新版本"
  document.querySelector("#check-updates").disabled = ["checking", "downloading"].includes(update.status)
}

function render() {
  document.querySelector("#version-label").textContent = state
    ? `v${state.app.version} · ${state.app.platform}-${state.app.arch}`
    : ""
  renderSettings()
  renderDownloads()
  renderUpdate()
  selectTab(activeTab)
}

document.querySelectorAll("[data-tab]").forEach(button => {
  button.addEventListener("click", () => selectTab(button.dataset.tab))
})

document.querySelectorAll("[data-setting=networkMode] [data-value]").forEach(button => {
  button.addEventListener("click", async () => {
    await window.shituDesktopCenter.setNetworkMode(button.dataset.value)
    state = await window.shituDesktopCenter.getState()
    render()
  })
})

document.querySelectorAll("[data-setting=downloadBehavior] [data-value]").forEach(button => {
  button.addEventListener("click", async () => {
    await window.shituDesktopCenter.setDownloadBehavior(button.dataset.value)
    state = await window.shituDesktopCenter.getState()
    render()
  })
})

document.querySelector("#run-diagnostics").addEventListener("click", async event => {
  const button = event.currentTarget
  button.disabled = true
  button.textContent = "正在诊断"
  try {
    renderDiagnostics(await window.shituDesktopCenter.diagnoseNetwork())
  } finally {
    button.disabled = false
    button.textContent = "开始诊断"
  }
})

document.querySelector("#clear-downloads").addEventListener("click", async () => {
  await window.shituDesktopCenter.clearDownloads()
  state = await window.shituDesktopCenter.getState()
  render()
})

document.querySelector("#open-network-settings").addEventListener("click", () => selectTab("network"))
document.querySelector("#check-updates").addEventListener("click", async () => {
  state.update = await window.shituDesktopCenter.checkForUpdates()
  renderUpdate()
})

window.shituDesktopCenter.onStateChanged(async () => {
  state = await window.shituDesktopCenter.getState()
  render()
})
window.shituDesktopCenter.onSelectTab(tab => selectTab(tab))

void window.shituDesktopCenter.getState().then(nextState => {
  state = nextState
  render()
  if (activeTab === "network") document.querySelector("#run-diagnostics").click()
})
