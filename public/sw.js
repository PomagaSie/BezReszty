// Service worker: shows push notifications and opens the panel when one is tapped. It caches nothing and never
// intercepts requests, so it cannot serve stale pages.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* Show the generic notification below. */ }
  // Browsers require every push to show something, so fall back to a neutral text rather than staying silent.
  event.waitUntil(self.registration.showNotification(String(data.title || 'BezReszty'), {
    body: String(data.body || ''), tag: data.tag ? String(data.tag) : undefined,
    icon: '/assets/images/icon-192.png', data: { url: typeof data.url === 'string' ? data.url : '/panel' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target;
  try { target = new URL(event.notification.data?.url || '/panel', self.location.origin); } catch { target = new URL('/panel', self.location.origin); }
  if (target.origin !== self.location.origin) target = new URL('/panel', self.location.origin);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (open) { await open.focus(); if ('navigate' in open) await open.navigate(target.href).catch(() => {}); }
    else await self.clients.openWindow(target.href);
  })());
});
