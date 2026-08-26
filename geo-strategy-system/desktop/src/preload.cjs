const { contextBridge, ipcRenderer } = require("electron")

function subscribe(channel, callback) {
  if (typeof callback !== "function") return () => undefined
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld("shituDesktop", Object.freeze({
  isDesktop: true,
  platform: process.platform,
  getInfo: () => ipcRenderer.invoke("desktop:get-info"),
  notify: payload => ipcRenderer.invoke("desktop:notify", payload),
  setBadgeCount: count => ipcRenderer.invoke("desktop:set-badge", count),
  openDesktopCenter: tab => ipcRenderer.invoke("desktop:open-center", tab),
  diagnoseNetwork: () => ipcRenderer.invoke("desktop:diagnose"),
  retryApplication: () => ipcRenderer.invoke("desktop:retry"),
  onNavigate: callback => subscribe("desktop:navigate", callback),
}))
