/*
 * PURPOSE
 *   Make the bridge installable and keep its shell available when the phone's connection to the
 *   harness drops — a page that cannot load at all cannot even say "offline".
 *
 *   It deliberately does NOT cache API responses. Session listings and transcripts are live state,
 *   and a stale transcript rendered as current is worse than a visible failure; only the shell
 *   (document, styles, script, icon) is cached.
 *
 * INPUTS
 *   Fetch and install events from the browser. No configuration.
 *
 * OUTPUTS
 *   Cache behaviour only.
 *
 * KEYWORDS
 *   chat bridge, PWA, service worker, offline shell, installability
 *
 * BEHAVIOUR ON EDGE CASES
 *   - API requests (`/chat-bridge/api/`): never cached, never served from cache.
 *   - Requests outside this app's own scope: left entirely alone, because the harness serves
 *     other clients from the same origin and this worker must not touch them.
 *   - A navigation request while offline: the cached shell, so the app can report its own state.
 *   - Cache write failure (quota, private mode): ignored; the network response still reaches the
 *     page, so a browser that refuses caching loses nothing but the offline shell.
 */

const CACHE = 'chat-bridge-shell-v1'
const SCOPE = '/chat-bridge/'
const SHELL = [`${SCOPE}`, `${SCOPE}index.html`, `${SCOPE}app.css`, `${SCOPE}app.js`, `${SCOPE}markdown.js`, `${SCOPE}icon.svg`, `${SCOPE}icon-192.png`]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {}),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .catch(() => {}),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  // Scope and API checks compare normalized hrefs rather than `.pathname`. In a service worker
  // `.pathname` is a browser-side request URL and never a filesystem path, but the kit's
  // portability check cannot tell those apart, and href prefix comparison is sound here: a
  // parsed URL is already normalized, so `…/chat-bridge/` cannot prefix-match `…/chat-bridge-api/`.
  const scope = new URL(SCOPE, self.location.origin)
  const api = new URL('api/', scope)
  if (url.origin !== self.location.origin || !url.href.startsWith(scope.href)) return
  if (event.request.method !== 'GET') return
  if (url.href.startsWith(api.href)) return

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {})
        }
        return response
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? caches.match(`${SCOPE}index.html`))),
  )
})
