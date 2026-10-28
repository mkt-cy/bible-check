// 오프라인용 캐시. 앱 파일을 고치면 VERSION을 올린다 → 다음 실행 때 새 파일로 교체
const VERSION = 'v12';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'lib/plan.js', 'lib/progress.js', 'lib/store.js',
  'data/books.json', 'data/church.json', 'data/sermons.json', 'plans/goodway-2026h2.json',
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
  // 설교 목록은 매주 바뀐다 → 네트워크 먼저, 안 되면 마지막으로 받은 것
  if (new URL(e.request.url).pathname.endsWith('/data/sermons.json')) {
    e.respondWith(fetch(e.request, { cache: 'no-cache' })
      .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
