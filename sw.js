const CACHE_NAME = 'rhythm-database-v3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)));
  // NIENTE self.skipWaiting() qui: il nuovo service worker resta in attesa
  // finché non è l'utente stesso a confermare l'aggiornamento dal banner in app.
});

self.addEventListener('message', (e)=>{
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e)=>{
  if(e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached=>{
      if(cached) return cached;
      return fetch(e.request).then(resp=>{
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(cache=>cache.put(e.request, clone));
        return resp;
      }).catch(()=>cached);
    })
  );
});
