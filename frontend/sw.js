// CampusShield Service Worker (PWA & Push Notifications)
const CACHE_NAME = 'campusshield-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/login',
  '/student',
  '/css/styles.css',
  '/icons/icon.svg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  console.log('[CampusShield SW] Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('[CampusShield SW] Initial caching warning:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[CampusShield SW] Service Worker activated.');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  return self.clients.claim();
});

// Intercept push notification events from server / Web Push
self.addEventListener('push', (event) => {
  let data = {
    title: '🚨 EMERGENCY ALERT - CampusShield',
    body: 'An urgent emergency report has been triggered on campus.',
    url: '/student',
    tag: 'emergency-alert',
    requireInteraction: true
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icons/icon.svg',
    badge: '/icons/icon.svg',
    tag: data.tag || 'campusshield-emergency',
    data: { url: data.url || '/student' },
    vibrate: [500, 150, 500, 150, 800],
    requireInteraction: true,
    renotify: true,
    actions: [
      { action: 'open_app', title: 'Open CampusShield 🛡️' },
      { action: 'call_security', title: 'Call Control (226500) 📞' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle clicking on the push notification banner
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'call_security') {
    event.waitUntil(
      self.clients.openWindow('tel:04294226500')
    );
    return;
  }

  const targetUrl = (event.notification.data && event.notification.data.url) || '/student';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
