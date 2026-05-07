/* LetsFG Service Worker — handles Web Push notifications */

self.addEventListener('push', function (event) {
  if (!event.data) return

  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: 'LetsFG', body: event.data.text() }
  }

  const options = {
    body: data.body || 'New flight price update',
    icon: data.icon || '/logo.png',
    badge: data.badge || '/logo.png',
    tag: data.tag || 'letsfg-monitor',
    renotify: true,
    data: {
      url: data.url || 'https://letsfg.co',
      ...(data.data || {}),
    },
    actions: [
      { action: 'view', title: 'View flights' },
    ],
  }

  event.waitUntil(
    self.registration.showNotification(data.title || '✈️ LetsFG flight update', options)
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()

  const url = event.notification.data?.url || 'https://letsfg.co'

  if (event.action === 'view' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
        for (const client of clientList) {
          if (client.url.startsWith('https://letsfg.co') && 'focus' in client) {
            client.navigate(url)
            return client.focus()
          }
        }
        return clients.openWindow(url)
      })
    )
  }
})

self.addEventListener('pushsubscriptionchange', function (event) {
  /* Re-subscribe when the push subscription is rotated by the browser. */
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
    }).then(function (subscription) {
      /* Notify the page so it can update the stored subscription. */
      return self.clients.matchAll({ type: 'window' }).then(function (clientList) {
        for (const client of clientList) {
          client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED', subscription: subscription.toJSON() })
        }
      })
    })
  )
})
