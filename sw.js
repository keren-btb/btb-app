// BtB Staff Portal — Service Worker
// Handles background push notifications (e.g. 🚨 help alerts).
// This file itself has no BUILD_VERSION UI tag — deployment updates are picked up
// automatically by the browser checking for byte changes to this file.
const SW_VERSION = '1.0.0';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// A push notification arrived from the server while the app may not be open.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Beyond the Box', body: event.data ? event.data.text() : 'New alert' };
  }

  const title = data.title || 'Beyond the Box';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'btb-alert',
    renotify: true,
    requireInteraction: true, // stays on screen until dismissed — appropriate for a help alert
    data: { url: data.url || 'staff_portal.html' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Staff tapped the notification — bring the staff portal to the front, or open it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || 'staff_portal.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('staff_portal.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
