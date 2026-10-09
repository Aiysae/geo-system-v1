const { contextBridge, ipcRenderer } = require("electron")

function subscribe(channel, callback) {
  if (typeof callback !== "function") return () => undefined
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld("shituDesktopCenter", Object.freeze({
  getState: () => ipcRenderer.invoke("desktop:center-state"),
  diagnoseNetwork: () => ipcRenderer.invoke("desktop:center-diagnose"),
  setNetworkMode: mode => ipcRenderer.invoke("desktop:center-network-mode", mode),
  setDownloadBehavior: behavior => ipcRenderer.invoke("desktop:center-download-behavior", behavior),
  openDownload: id => ipcRenderer.invoke("desktop:center-open-download", id),
  cancelDownload: id => ipcRenderer.invoke("desktop:center-cancel-download", id),
  clearDownloads: () => ipcRenderer.invoke("desktop:center-clear-downloads"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:center-check-updates"),
  retryApplication: () => ipcRenderer.invoke("desktop:center-retry-app"),
  onStateChanged: callback => subscribe("desktop:center-state-changed", callback),
  onSelectTab: callback => subscribe("desktop:center-select-tab", callback),
}))
