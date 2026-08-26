const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const { sanitizeFilename } = require("./security.cjs")

function uniquePath(directory, filename) {
  const parsed = path.parse(filename)
  let candidate = path.join(directory, filename)
  let index = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${parsed.name}-${index}${parsed.ext}`)
    index += 1
  }
  return candidate
}

function publicRecord(record) {
  const { item, ...safe } = record
  void item
  return { ...safe }
}

function createDownloadManager({
  app,
  dialog,
  Notification,
  shell,
  session,
  getMainWindow,
  getSettings,
  broadcast,
}) {
  const records = new Map()
  let attached = false

  function emit(record) {
    record.updatedAt = Date.now()
    broadcast("desktop:center-state-changed", { type: "download", download: publicRecord(record) })
  }

  function notifyFinished(record) {
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: record.status === "completed" ? "文件已保存" : "文件下载未完成",
      body: record.status === "completed"
        ? `${record.filename} 已保存到电脑`
        : `${record.filename} 下载${record.status === "cancelled" ? "已取消" : "中断"}`,
      silent: record.status !== "completed",
    })
    if (record.status === "completed") {
      notification.on("click", () => shell.showItemInFolder(record.savePath))
    }
    notification.show()
  }

  async function chooseSavePath(record) {
    const downloadsDirectory = path.join(app.getPath("downloads"), "势途 GEO")
    fs.mkdirSync(downloadsDirectory, { recursive: true })
    const suggestedPath = uniquePath(downloadsDirectory, record.filename)
    if (getSettings().downloadBehavior === "automatic") return suggestedPath

    const result = await dialog.showSaveDialog(getMainWindow() || undefined, {
      title: "保存势途 GEO 文件",
      buttonLabel: "保存",
      defaultPath: suggestedPath,
      properties: ["createDirectory", "showOverwriteConfirmation"],
    })
    return result.canceled ? "" : String(result.filePath || "")
  }

  function attach() {
    if (attached) return
    attached = true
    session.on("will-download", (_event, item) => {
      const id = crypto.randomUUID()
      const filename = sanitizeFilename(item.getFilename())
      const record = {
        id,
        item,
        filename,
        savePath: "",
        status: "choosing",
        receivedBytes: 0,
        totalBytes: Math.max(0, item.getTotalBytes()),
        startedAt: Date.now(),
        updatedAt: Date.now(),
        finished: false,
      }
      records.set(id, record)
      item.pause()
      emit(record)

      void chooseSavePath(record).then(savePath => {
        if (record.finished) return
        if (!savePath) {
          item.cancel()
          record.status = "cancelled"
          emit(record)
          return
        }
        record.savePath = savePath
        record.status = "progressing"
        item.setSavePath(savePath)
        item.resume()
        emit(record)
      }).catch(() => {
        if (record.finished) return
        if (!record.finished) item.cancel()
        record.status = "interrupted"
        emit(record)
      })

      let lastEmit = 0
      item.on("updated", (_downloadEvent, state) => {
        record.status = state === "interrupted" ? "interrupted" : "progressing"
        record.receivedBytes = item.getReceivedBytes()
        record.totalBytes = Math.max(record.totalBytes, item.getTotalBytes())
        const now = Date.now()
        if (now - lastEmit >= 250) {
          lastEmit = now
          emit(record)
        }
      })

      item.once("done", (_downloadEvent, state) => {
        record.finished = true
        record.status = state === "completed"
          ? "completed"
          : state === "cancelled" ? "cancelled" : "interrupted"
        record.receivedBytes = item.getReceivedBytes()
        record.totalBytes = Math.max(record.totalBytes, item.getTotalBytes())
        emit(record)
        notifyFinished(record)
      })
    })
  }

  return {
    attach,
    list() {
      return Array.from(records.values())
        .sort((left, right) => right.startedAt - left.startedAt)
        .slice(0, 100)
        .map(publicRecord)
    },
    cancel(id) {
      const record = records.get(id)
      if (!record || !["choosing", "progressing"].includes(record.status)) return false
      if (!record.finished) record.item.cancel()
      return true
    },
    async open(id) {
      const record = records.get(id)
      if (!record?.savePath || record.status !== "completed" || !fs.existsSync(record.savePath)) return false
      shell.showItemInFolder(record.savePath)
      return true
    },
    clearFinished() {
      for (const [id, record] of records.entries()) {
        if (!["choosing", "progressing"].includes(record.status)) records.delete(id)
      }
      broadcast("desktop:center-state-changed", { type: "downloads-cleared" })
    },
  }
}

module.exports = { createDownloadManager, uniquePath }
