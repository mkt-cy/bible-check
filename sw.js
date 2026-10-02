// 오프라인용 캐시. 앱 파일을 고치면 VERSION을 올린다 → 다음 실행 때 새 파일로 교체
const VERSION = 'v2';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'lib/plan.js', 'lib/progress.js', 'lib/store.js',
  'data/books.json', 'plans/goodway-2026h2.json',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' = 브라우저 HTTP 캐시를 건너뛰고 새 파일로 채운다
  const fresh = SHELL.map((u) => new Request(u, { cache: 'reload' }));
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 캐시 먼저 → 없으면 네트워크 (기록은 IndexedDB에 있으므로 여기서 다루지 않는다)
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
