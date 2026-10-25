// Retire the old Workbox navigation fallback. It intercepted /auth/handoff and
// prevented the admin worker from exchanging OAuth handoffs. Keep this small
// worker available until existing installations have updated and unregistered.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.map((name) => caches.delete(name))))
      .then(() => self.registration.unregister()),
  );
});
