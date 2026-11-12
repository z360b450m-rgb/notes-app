const CACHE = 'cuoti-app-v4'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['./', './index.html'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('cuoti-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  if (!e.request.url.startsWith('http')) return
  const url = new URL(e.request.url)
  if (url.origin !== self.location.origin) return
  if (e.request.headers.has('Authorization') || url.pathname.startsWith('/api/')) return
  if (/\.(exe|zip|ctb|dmg|AppImage|deb)$/i.test(url.pathname)) return
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(async (response) => {
          if (response.ok) {
            const clone = response.clone()
            await caches.open(CACHE).then((cache) => cache.put(e.request, clone))
          }
          return response
        })
        .catch(
          async () =>
            (await caches.match(e.request)) ||
            (await caches.match('./index.html')) ||
            Response.error(),
        ),
    )
    return
  }
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request)
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            const clone = resp.clone()
            caches.open(CACHE).then((cache) => cache.put(e.request, clone))
          }
          return resp
        })
        .catch(() => cached)
      return cached || fetched
    }),
  )
})
