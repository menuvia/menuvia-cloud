// Menuvia — Service Worker
// Handles:
//   1. Web Push Notifications (kitchen staff)
//   2. Background Sync (offline waiter orders)
//   3. Offline cache (QR menu — clientul vede meniul chiar fără rețea)
//   4. App shell cache (instalabil ca PWA pe telefon)

// Bump-uiește această versiune la fiecare deploy cu schimbări de app shell
// sau de bundle care fac neaplicabil cache-ul vechi. Activate handler
// șterge automat cache-urile cu nume diferit, deci utilizatorii cu PWA
// primesc instantaneu noul build (nu mai trebuie hard refresh manual).
const CACHE_VERSION = 'menuvia-v3'
const APP_SHELL = [
  '/favicon.svg',
  '/manifest.json',
]

// ── Install: cache app shell ────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  )
  self.skipWaiting()
})

// ── Activate: clean up old caches ───────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
      .then(() => clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((windowClients) => {
        for (const client of windowClients) {
          client.navigate(client.url)
        }
      })
  )
})

// ── Fetch: routing strategies ───────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Skip cross-origin (Supabase, Stripe)
  if (url.origin !== self.location.origin) return
  // Skip Netlify functions
  if (url.pathname.startsWith('/.netlify/')) return

  if (isDocumentRequest(req)) {
    event.respondWith(networkFirstWithFallback(req))
    return
  }

  // QR menu pages: stale-while-revalidate (show cached, update in bg)
  if (url.pathname.startsWith('/menu/') || url.pathname.startsWith('/qr/')) {
    event.respondWith(staleWhileRevalidate(req))
    return
  }

  // App shell + static assets: cache-first
  if (
    APP_SHELL.includes(url.pathname) ||
    url.pathname.startsWith('/assets/') ||
    /\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(req))
    return
  }

  // Everything else: network-first with offline fallback to app shell
  event.respondWith(networkFirstWithFallback(req))
})

function isDocumentRequest(req) {
  return req.mode === 'navigate' || req.destination === 'document' || req.headers.get('accept')?.includes('text/html')
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_VERSION)
  const cached = await cache.match(req)
  const networkFetch = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone())
      return res
    })
    .catch(() => cached)
  return cached || networkFetch
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_VERSION)
  const cached = await cache.match(req)
  if (cached) return cached
  try {
    const res = await fetch(req)
    if (res.ok) cache.put(req, res.clone())
    return res
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

async function networkFirstWithFallback(req) {
  try {
    const res = await fetch(req)
    if (res.ok) {
      const cache = await caches.open(CACHE_VERSION)
      cache.put(req, res.clone())
    }
    return res
  } catch {
    const cache = await caches.open(CACHE_VERSION)
    const cached = await cache.match(req)
    if (cached) return cached
    return cache.match('/')
  }
}

// ── Push Notifications ──────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload = {}
  try { payload = event.data.json() } catch { payload = { title: 'Comandă nouă', body: event.data.text() } }

  const title   = payload.title || 'Menuvia — Comandă nouă'
  const options = {
    body:     payload.body    || 'O comandă nouă așteaptă în bucătărie.',
    icon:     '/favicon.svg',
    badge:    '/favicon.svg',
    tag:      payload.tag     || 'menuvia-order',
    renotify: true,
    vibrate:  [200, 100, 200],
    data:     { url: payload.url || '/kitchen', orderId: payload.orderId },
    actions:  [{ action: 'open', title: 'Deschide bucătăria' }],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/kitchen'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes('/kitchen') || client.url.includes('/waiter')) {
          return 'focus' in client ? client.focus() : null
        }
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})

// ── Background Sync (offline waiter orders) ─────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag !== 'sync-orders') return
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        if (windowClients.length === 0) return
        const active = windowClients.find(c => c.focused) || windowClients[0]
        active.postMessage({ type: 'SYNC_NOW' })
      })
  )
})

// ── Message channel ─────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then((keys) => Promise.all(keys.map(k => caches.delete(k))))
  }
})
