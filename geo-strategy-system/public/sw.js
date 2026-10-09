const CACHE_NAME = "shitu-geo-static-2026-09-01-1"
const OFFLINE_URL = "/offline.html"
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/pwa/icon-192.png",
  "/pwa/icon-512.png",
  "/brand/shitu-lockup-transparent-v2.png",
]

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith("shitu-geo-static-") && key !== CACHE_NAME)
          .map(key => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", event => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return
  if (request.mode !== "navigate") return

  event.respondWith(
    fetch(request).catch(async () => (
      await caches.match(OFFLINE_URL)
      || new Response("当前网络不可用，请恢复网络后重试。", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    )),
  )
})
