const dns = require("node:dns")
const path = require("node:path")
const { fileURLToPath, pathToFileURL } = require("node:url")
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  protocol,
  session,
  shell,
  Tray,
} = require("electron")
const { autoUpdater } = require("electron-updater")
const { createDownloadManager } = require("./download-manager.cjs")
const {
  DEFAULT_APP_URL,
  isSafeExternalUrl,
  isTrustedAppUrl,
  normalizeAppUrl,
  resolveDesktopDeepLink,
  safeInternalUrl,
  sanitizeNotification,
} = require("./security.cjs")
const { createSettingsStore } = require("./settings.cjs")

const TEST_MODE = process.env.SHITU_DESKTOP_TEST_MODE === "1"
const APP_URL = normalizeAppUrl(process.env.SHITU_DESKTOP_URL || DEFAULT_APP_URL, {
  allowLocalhost: !app.isPackaged || TEST_MODE,
  allowFile: TEST_MODE,
})
const PACKAGE_ROOT = path.join(__dirname, "..")
const RENDERER_DIRECTORY = path.join(PACKAGE_ROOT, "renderer")
const ASSET_DIRECTORY = path.join(PACKAGE_ROOT, "assets")
const ICON_PATH = path.join(ASSET_DIRECTORY, "icon.png")
const LOCAL_SCHEME = "shitu-app"
const LOCAL_ORIGIN = `${LOCAL_SCHEME}://app`
const CENTER_URL = `${LOCAL_ORIGIN}/renderer/desktop-center.html`
const OFFLINE_URL = `${LOCAL_ORIGIN}/renderer/offline.html`

protocol.registerSchemesAsPrivileged([{
  scheme: LOCAL_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
  },
}])

let mainWindow = null
let splashWindow = null
let centerWindow = null
let tray = null
let settingsStore = null
let downloadManager = null
let isQuitting = false
let appIsOffline = false
let updateState = { status: "idle", message: "当前已是最新版本" }
const displayedNotifications = new Map()

app.setName("势途 GEO")
app.setAppUserModelId("cn.shitu.geo.desktop")
app.enableSandbox()

function isLocalRendererUrl(value) {
  try {
    const parsed = new URL(String(value || ""))
    if (parsed.protocol === `${LOCAL_SCHEME}:`) {
      return parsed.hostname === "app" && parsed.pathname.startsWith("/renderer/")
    }
    if (parsed.protocol !== "file:") return false
    const target = fileURLToPath(parsed)
    return target.startsWith(`${RENDERER_DIRECTORY}${path.sep}`)
  } catch {
    return false
  }
}

function localRendererUrl(filename, query = {}) {
  const target = new URL(`/renderer/${filename}`, `${LOCAL_ORIGIN}/`)
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, String(value))
  return target.toString()
}

function registerLocalProtocol() {
  protocol.handle(LOCAL_SCHEME, request => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== "app") return new Response("Not found", { status: 404 })

      const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "")
      if (!relativePath.startsWith("renderer/") && !relativePath.startsWith("assets/")) {
        return new Response("Forbidden", { status: 403 })
      }

      const filePath = path.resolve(PACKAGE_ROOT, relativePath)
      if (!filePath.startsWith(`${PACKAGE_ROOT}${path.sep}`)) {
        return new Response("Forbidden", { status: 403 })
      }
      return net.fetch(pathToFileURL(filePath).toString(), {
        bypassCustomProtocolHandlers: true,
      })
    } catch {
      return new Response("Not found", { status: 404 })
    }
  })
}

function senderUrl(event) {
  return event.senderFrame?.url || event.sender.getURL()
}

function assertRemoteSender(event) {
  if (!isTrustedAppUrl(senderUrl(event), APP_URL)) throw new Error("Untrusted desktop IPC sender")
}

function assertCenterSender(event) {
  if (senderUrl(event).split("?")[0] !== CENTER_URL) throw new Error("Untrusted desktop center sender")
}

function broadcastCenter(payload) {
  if (centerWindow && !centerWindow.isDestroyed()) {
    centerWindow.webContents.send("desktop:center-state-changed", payload)
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function navigateMainWindow(value) {
  const target = safeInternalUrl(value, APP_URL) || resolveDesktopDeepLink(value, APP_URL)
  if (!target) return false
  focusMainWindow()
  if (isTrustedAppUrl(mainWindow.webContents.getURL(), APP_URL)) {
    mainWindow.webContents.send("desktop:navigate", target)
  } else {
    void mainWindow.loadURL(target)
  }
  return true
}

function pruneNotificationIds() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const [id, timestamp] of displayedNotifications.entries()) {
    if (timestamp < cutoff) displayedNotifications.delete(id)
  }
}

function showNativeNotification(payload) {
  const sanitized = sanitizeNotification(payload, APP_URL)
  if (!sanitized || !Notification.isSupported()) return false
  pruneNotificationIds()
  if (sanitized.id && displayedNotifications.has(sanitized.id)) return true
  if (sanitized.id) displayedNotifications.set(sanitized.id, Date.now())

  const notification = new Notification({
    title: sanitized.title,
    body: sanitized.body,
    icon: ICON_PATH,
  })
  notification.on("click", () => {
    if (sanitized.actionUrl) navigateMainWindow(sanitized.actionUrl)
    else focusMainWindow()
  })
  notification.show()
  return true
}

async function applyNetworkMode(mode) {
  const nextMode = mode === "direct" ? "direct" : "system"
  await session.defaultSession.setProxy({ mode: nextMode })
  await session.defaultSession.closeAllConnections()
  settingsStore?.update({ networkMode: nextMode })
  buildApplicationMenu()
  broadcastCenter({ type: "settings", settings: settingsStore?.get() })
  return nextMode
}

async function runNetworkDiagnostics() {
  const startedAt = Date.now()
  const application = new URL(APP_URL)
  const result = {
    checkedAt: new Date().toISOString(),
    networkMode: settingsStore?.get().networkMode || "system",
    online: net.isOnline(),
    hostname: application.hostname || "local-file",
    dns: { ok: false, latencyMs: 0, address: "" },
    proxy: { ok: false, latencyMs: 0, value: "" },
    service: { ok: false, latencyMs: 0, status: 0, message: "" },
    totalLatencyMs: 0,
  }

  if (application.protocol === "file:") {
    result.online = true
    result.dns = { ok: true, latencyMs: 0, address: "local" }
    result.proxy = { ok: true, latencyMs: 0, value: "DIRECT" }
    result.service = { ok: true, latencyMs: 0, status: 200, message: "desktop-test" }
    result.totalLatencyMs = Date.now() - startedAt
    return result
  }

  const dnsStartedAt = Date.now()
  try {
    const address = await dns.promises.lookup(application.hostname)
    result.dns = { ok: true, latencyMs: Date.now() - dnsStartedAt, address: address.address }
  } catch (error) {
    result.dns = {
      ok: false,
      latencyMs: Date.now() - dnsStartedAt,
      address: error instanceof Error ? error.message.slice(0, 120) : "DNS 解析失败",
    }
  }

  const proxyStartedAt = Date.now()
  try {
    const value = await session.defaultSession.resolveProxy(APP_URL)
    result.proxy = { ok: true, latencyMs: Date.now() - proxyStartedAt, value: String(value || "DIRECT") }
  } catch (error) {
    result.proxy = {
      ok: false,
      latencyMs: Date.now() - proxyStartedAt,
      value: error instanceof Error ? error.message.slice(0, 120) : "代理检测失败",
    }
  }

  const serviceStartedAt = Date.now()
  const healthUrl = new URL("/api/desktop/health", APP_URL).toString()
  try {
    const response = await net.fetch(healthUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    })
    const body = await response.json().catch(() => ({}))
    result.service = {
      ok: response.ok && body?.status === "ok",
      latencyMs: Date.now() - serviceStartedAt,
      status: response.status,
      message: response.ok ? "势途 GEO 服务连接正常" : `HTTP ${response.status}`,
    }
  } catch (error) {
    result.service = {
      ok: false,
      latencyMs: Date.now() - serviceStartedAt,
      status: 0,
      message: error instanceof Error ? error.message.slice(0, 160) : "服务连接失败",
    }
  }
  result.totalLatencyMs = Date.now() - startedAt
  return result
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 520,
    height: 340,
    frame: false,
    transparent: false,
    resizable: false,
    show: false,
    backgroundColor: "#001D66",
    alwaysOnTop: true,
    icon: ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  void splashWindow.loadURL(localRendererUrl("splash.html"))
  splashWindow.once("ready-to-show", () => splashWindow?.show())
}

function showMainWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
  splashWindow = null
  focusMainWindow()
}

async function loadRemoteApplication(target = APP_URL) {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  const targetWindow = mainWindow
  const safeTarget = safeInternalUrl(target, APP_URL)
  if (!safeTarget) return false
  appIsOffline = false
  try {
    await targetWindow.loadURL(safeTarget)
    return true
  } catch {
    if (isQuitting || targetWindow.isDestroyed() || mainWindow !== targetWindow) return false
    appIsOffline = true
    await targetWindow.loadURL(OFFLINE_URL)
    return false
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: "#F3F8FF",
    title: "势途 GEO",
    icon: ICON_PATH,
    titleBarStyle: "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
      navigateOnDragDrop: false,
      webviewTag: false,
      spellcheck: true,
    },
  })

  const defaultUserAgent = mainWindow.webContents.getUserAgent()
  mainWindow.webContents.setUserAgent(`${defaultUserAgent} ShituGEODesktop/${app.getVersion()}`)

  mainWindow.webContents.on("did-finish-load", () => {
    appIsOffline = mainWindow.webContents.getURL().split("?")[0] === OFFLINE_URL
    showMainWindow()
  })
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, _description, validatedUrl, isMainFrame) => {
    if (isQuitting || !isMainFrame || errorCode === -3 || isLocalRendererUrl(validatedUrl)) return
    appIsOffline = true
    if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(OFFLINE_URL)
  })
  mainWindow.webContents.on("render-process-gone", () => {
    if (!isQuitting) void loadRemoteApplication()
  })
  mainWindow.on("unresponsive", () => {
    showNativeNotification({
      id: `unresponsive:${Date.now()}`,
      title: "势途 GEO 暂时无响应",
      body: "桌面端正在等待当前页面，后台任务不会中断。",
    })
  })
  mainWindow.on("close", event => {
    if (isQuitting || TEST_MODE) return
    event.preventDefault()
    mainWindow.hide()
  })
  mainWindow.on("closed", () => {
    mainWindow = null
  })

  void loadRemoteApplication()
}

function createCenterWindow(initialTab = "downloads") {
  if (centerWindow && !centerWindow.isDestroyed()) {
    centerWindow.show()
    centerWindow.focus()
    centerWindow.webContents.send("desktop:center-select-tab", initialTab)
    return
  }
  centerWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 760,
    minHeight: 580,
    show: false,
    parent: process.platform === "darwin" ? mainWindow : undefined,
    backgroundColor: "#F4F8FF",
    title: "势途 GEO 桌面中心",
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "center-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  void centerWindow.loadURL(localRendererUrl("desktop-center.html", { tab: initialTab }))
  centerWindow.once("ready-to-show", () => centerWindow?.show())
  centerWindow.on("closed", () => {
    centerWindow = null
  })
}

function openExternal(value) {
  if (isSafeExternalUrl(value)) void shell.openExternal(value)
}

function installWebContentsGuards() {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", event => event.preventDefault())
    contents.on("will-navigate", (event, targetUrl) => {
      if (isTrustedAppUrl(targetUrl, APP_URL) || isLocalRendererUrl(targetUrl)) return
      event.preventDefault()
      openExternal(targetUrl)
    })
    contents.setWindowOpenHandler(details => {
      if (isTrustedAppUrl(details.url, APP_URL)) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            icon: ICON_PATH,
            backgroundColor: "#F4F8FF",
            webPreferences: {
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              webSecurity: true,
              allowRunningInsecureContent: false,
              webviewTag: false,
            },
          },
        }
      }
      openExternal(details.url)
      return { action: "deny" }
    })
  })
}

function configurePermissions() {
  const canWriteClipboard = (webContents, permission) => permission === "clipboard-sanitized-write"
    && Boolean(webContents)
    && isTrustedAppUrl(webContents.getURL(), APP_URL)
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return canWriteClipboard(webContents, permission)
  })
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(canWriteClipboard(webContents, permission))
  })
  session.defaultSession.setDevicePermissionHandler(() => false)
}

function buildApplicationMenu() {
  const networkMode = settingsStore?.get().networkMode || "system"
  const template = [
    ...(process.platform === "darwin" ? [{
      label: "势途 GEO",
      submenu: [
        { role: "about", label: "关于势途 GEO" },
        { type: "separator" },
        { role: "hide", label: "隐藏势途 GEO" },
        { role: "hideOthers", label: "隐藏其他应用" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { role: "quit", label: "退出势途 GEO" },
      ],
    }] : []),
    {
      label: "工作台",
      submenu: [
        { label: "打开首页", accelerator: "CmdOrCtrl+Shift+H", click: () => navigateMainWindow(new URL("/", APP_URL)) },
        { label: "打开工作台", accelerator: "CmdOrCtrl+Shift+W", click: () => navigateMainWindow(new URL("/workspace", APP_URL)) },
        { label: "我的主页", click: () => navigateMainWindow(new URL("/account", APP_URL)) },
        { type: "separator" },
        { label: "下载记录", accelerator: "CmdOrCtrl+J", click: () => createCenterWindow("downloads") },
        { label: "桌面设置", click: () => createCenterWindow("settings") },
        ...(process.platform === "darwin" ? [] : [
          { type: "separator" },
          { role: "quit", label: "退出势途 GEO" },
        ]),
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "显示",
      submenu: [
        { label: "后退", accelerator: "Alt+Left", click: () => mainWindow?.webContents.canGoBack() && mainWindow.webContents.goBack() },
        { label: "前进", accelerator: "Alt+Right", click: () => mainWindow?.webContents.canGoForward() && mainWindow.webContents.goForward() },
        { role: "reload", label: "刷新" },
        { role: "forceReload", label: "强制刷新" },
        { type: "separator" },
        { role: "resetZoom", label: "恢复默认缩放" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { role: "togglefullscreen", label: "全屏" },
        ...(!app.isPackaged ? [{ role: "toggleDevTools", label: "开发者工具" }] : []),
      ],
    },
    {
      label: "网络",
      submenu: [
        {
          label: "跟随系统网络",
          type: "radio",
          checked: networkMode === "system",
          click: () => void applyNetworkMode("system").then(() => loadRemoteApplication(mainWindow?.webContents.getURL() || APP_URL)),
        },
        {
          label: "直连势途服务",
          type: "radio",
          checked: networkMode === "direct",
          click: () => void applyNetworkMode("direct").then(() => loadRemoteApplication(mainWindow?.webContents.getURL() || APP_URL)),
        },
        { type: "separator" },
        { label: "运行网络诊断", click: () => createCenterWindow("network") },
      ],
    },
    {
      label: "帮助",
      submenu: [
        { label: "使用说明", click: () => navigateMainWindow(new URL("/help", APP_URL)) },
        { label: "Agent 接入说明", click: () => navigateMainWindow(new URL("/agent", APP_URL)) },
        { type: "separator" },
        { label: "检查桌面端更新", click: () => void checkForUpdates(true) },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createTray() {
  const image = nativeImage.createFromPath(ICON_PATH).resize({ width: 20, height: 20 })
  tray = new Tray(image)
  tray.setToolTip("势途 GEO 全链路操作工具")
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开势途 GEO", click: focusMainWindow },
    { label: "工作台", click: () => navigateMainWindow(new URL("/workspace", APP_URL)) },
    { label: "下载记录", click: () => createCenterWindow("downloads") },
    { label: "网络诊断", click: () => createCenterWindow("network") },
    { type: "separator" },
    { label: "退出", click: () => { isQuitting = true; app.quit() } },
  ]))
  tray.on("click", focusMainWindow)
}

function setUpdateState(status, message, extra = {}) {
  updateState = { status, message, ...extra }
  broadcastCenter({ type: "update", update: updateState })
}

function isMissingPublishedVersion(error) {
  return String(error?.message || error || "").includes("No published versions")
}

async function checkForUpdates(userInitiated = false) {
  if (!app.isPackaged || TEST_MODE) {
    setUpdateState("development", "开发版不检查在线更新")
    if (userInitiated) createCenterWindow("updates")
    return updateState
  }
  setUpdateState("checking", "正在检查新版本")
  if (userInitiated) createCenterWindow("updates")
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    if (isMissingPublishedVersion(error)) {
      setUpdateState("current", "当前已是最新内部版本")
    } else {
      setUpdateState("error", error instanceof Error ? error.message : "更新检查失败")
    }
  }
  return updateState
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on("checking-for-update", () => setUpdateState("checking", "正在检查新版本"))
  autoUpdater.on("update-available", info => setUpdateState("downloading", `正在下载 ${info.version}`))
  autoUpdater.on("update-not-available", () => setUpdateState("current", "当前已是最新版本"))
  autoUpdater.on("download-progress", progress => {
    setUpdateState("downloading", `正在下载新版本 ${Math.round(progress.percent)}%`, { percent: progress.percent })
  })
  autoUpdater.on("update-downloaded", info => {
    setUpdateState("ready", `${info.version} 已准备好，退出后自动安装`)
    const notification = new Notification({
      title: "势途 GEO 新版本已就绪",
      body: "点击立即重启并完成更新。",
      icon: ICON_PATH,
    })
    notification.on("click", () => {
      isQuitting = true
      autoUpdater.quitAndInstall()
    })
    notification.show()
  })
  autoUpdater.on("error", error => {
    if (isMissingPublishedVersion(error)) setUpdateState("current", "当前已是最新内部版本")
    else setUpdateState("error", error.message || "更新检查失败")
  })
  if (app.isPackaged && !TEST_MODE) setTimeout(() => void checkForUpdates(false), 15_000)
}

function registerIpcHandlers() {
  ipcMain.handle("desktop:get-info", event => {
    assertRemoteSender(event)
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      networkMode: settingsStore.get().networkMode,
    }
  })
  ipcMain.handle("desktop:notify", (event, payload) => {
    assertRemoteSender(event)
    return showNativeNotification(payload)
  })
  ipcMain.handle("desktop:set-badge", (event, count) => {
    assertRemoteSender(event)
    const nextCount = Math.max(0, Math.min(999, Number(count) || 0))
    if (app.dock && process.platform === "darwin") app.dock.setBadge(nextCount > 0 ? String(nextCount) : "")
    else app.setBadgeCount(nextCount)
    return nextCount
  })
  ipcMain.handle("desktop:open-center", (event, tab) => {
    assertRemoteSender(event)
    createCenterWindow(["downloads", "network", "settings", "updates"].includes(tab) ? tab : "downloads")
    return true
  })
  ipcMain.handle("desktop:diagnose", async event => {
    assertRemoteSender(event)
    return await runNetworkDiagnostics()
  })

  ipcMain.handle("desktop:retry", event => {
    if (!isLocalRendererUrl(senderUrl(event))) throw new Error("Untrusted retry sender")
    return loadRemoteApplication()
  })

  ipcMain.handle("desktop:center-state", event => {
    assertCenterSender(event)
    return {
      app: { name: app.getName(), version: app.getVersion(), platform: process.platform, arch: process.arch },
      settings: settingsStore.get(),
      downloads: downloadManager.list(),
      update: updateState,
      offline: appIsOffline,
    }
  })
  ipcMain.handle("desktop:center-diagnose", async event => {
    assertCenterSender(event)
    return await runNetworkDiagnostics()
  })
  ipcMain.handle("desktop:center-network-mode", async (event, mode) => {
    assertCenterSender(event)
    const nextMode = await applyNetworkMode(mode)
    await loadRemoteApplication(APP_URL)
    return nextMode
  })
  ipcMain.handle("desktop:center-download-behavior", (event, behavior) => {
    assertCenterSender(event)
    const settings = settingsStore.update({ downloadBehavior: behavior })
    broadcastCenter({ type: "settings", settings })
    return settings.downloadBehavior
  })
  ipcMain.handle("desktop:center-open-download", async (event, id) => {
    assertCenterSender(event)
    return await downloadManager.open(String(id || ""))
  })
  ipcMain.handle("desktop:center-cancel-download", (event, id) => {
    assertCenterSender(event)
    return downloadManager.cancel(String(id || ""))
  })
  ipcMain.handle("desktop:center-clear-downloads", event => {
    assertCenterSender(event)
    downloadManager.clearFinished()
    return true
  })
  ipcMain.handle("desktop:center-check-updates", async event => {
    assertCenterSender(event)
    return await checkForUpdates(false)
  })
  ipcMain.handle("desktop:center-retry-app", event => {
    assertCenterSender(event)
    return loadRemoteApplication(APP_URL)
  })
}

installWebContentsGuards()

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on("second-instance", (_event, commandLine) => {
    const deepLink = commandLine.find(argument => argument.startsWith("shitugeo://"))
    if (!deepLink || !navigateMainWindow(deepLink)) focusMainWindow()
  })
  app.on("open-url", (event, url) => {
    event.preventDefault()
    navigateMainWindow(url)
  })

  app.whenReady().then(async () => {
    registerLocalProtocol()
    settingsStore = createSettingsStore(app.getPath("userData"))
    await applyNetworkMode(settingsStore.get().networkMode)
    configurePermissions()
    registerIpcHandlers()
    downloadManager = createDownloadManager({
      app,
      dialog,
      Notification,
      shell,
      session: session.defaultSession,
      getMainWindow: () => mainWindow,
      getSettings: () => settingsStore.get(),
      broadcast: (_channel, payload) => broadcastCenter(payload),
    })
    downloadManager.attach()
    createSplashWindow()
    createMainWindow()
    createTray()
    buildApplicationMenu()
    configureAutoUpdater()
    if (app.isPackaged) app.setAsDefaultProtocolClient("shitugeo")
  })

  app.on("activate", () => {
    if (!mainWindow) createMainWindow()
    else focusMainWindow()
  })
  app.on("before-quit", () => {
    isQuitting = true
  })
  app.on("window-all-closed", () => {
    if (TEST_MODE) app.quit()
  })
}
