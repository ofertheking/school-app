// Offline support + on-device .ics generation for "add to calendar".
const CACHE = 'school-app-v11';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/core.js',
  './js/store.js',
  './js/util.js',
  './js/ui.js',
  './js/views.js',
  './js/charts.js',
  './js/icons.js',
  './js/integrations.js',
  './js/components.js',
  './js/router.js',
  './js/schedule.js',
  './js/flashcards.js',
  './js/importer.js',
  './js/webtop.js',
  './js/files.js',
  './js/notebooks.js',
  './js/pdf.js',
  './js/pdfTimetable.js',
  './js/appearance.js',
  './js/search.js',
  './js/grades.js',
  './js/calendar.js',
  './webtop-worker.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache so a new version gets fresh files.
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fromB64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Calendar file built on the device: cal.ics?d=<base64url>
  if (url.pathname.endsWith('/cal.ics')) {
    try {
      const body = fromB64url(url.searchParams.get('d') || '');
      e.respondWith(
        new Response(body, {
          headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'inline; filename="exam.ics"',
          },
        })
      );
    } catch {
      e.respondWith(new Response('bad calendar data', { status: 400 }));
    }
    return;
  }

  // App shell for navigations (works offline), network refresh in background.
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html').then((cached) => {
        const net = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put('./index.html', copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  // Stale-while-revalidate for everything else on our origin.
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});
