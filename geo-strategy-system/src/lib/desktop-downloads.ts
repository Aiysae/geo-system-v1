export const DESKTOP_APP_VERSION = "1.0.0"
export const DESKTOP_RELEASE_TAG = `desktop-v${DESKTOP_APP_VERSION}`

const RELEASE_BASE_URL = `https://github.com/Aiysae/geo-system-v1/releases/download/${DESKTOP_RELEASE_TAG}`

export const DESKTOP_DOWNLOADS = {
  windows: {
    platform: "windows",
    label: "Windows",
    detail: "Windows 10 / 11 · 64 位",
    fileName: `Shitu-GEO-${DESKTOP_APP_VERSION}-win-x64.exe`,
    url: `${RELEASE_BASE_URL}/Shitu-GEO-${DESKTOP_APP_VERSION}-win-x64.exe`,
  },
  mac: {
    platform: "mac",
    label: "macOS",
    detail: "macOS 12 及以上 · Apple 芯片与 Intel",
    fileName: `Shitu-GEO-${DESKTOP_APP_VERSION}-mac-universal.dmg`,
    url: `${RELEASE_BASE_URL}/Shitu-GEO-${DESKTOP_APP_VERSION}-mac-universal.dmg`,
  },
} as const

export type DesktopDownloadPlatform = keyof typeof DESKTOP_DOWNLOADS

export function getDesktopDownload(platform: string) {
  return platform === "windows" || platform === "mac"
    ? DESKTOP_DOWNLOADS[platform]
    : null
}
