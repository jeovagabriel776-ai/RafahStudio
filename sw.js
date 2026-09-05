const CACHE='rafahstudio-performance-3';
const ASSETS=[
  './','./index.html','./style.css','./app.js','./manifest.json',
  './assets/logo.svg','./assets/logo2.svg',
  './assets/icon-192.png','./assets/icon-512.png'
];
self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).catch(()=>{}));
});
self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))
    )).then(()=>self.clients.claim())
  );
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(
    fetch(e.request).then(r=>{
      if(r && r.ok){
        const c=r.clone();
        caches.open(CACHE).then(x=>x.put(e.request,c)).catch(()=>{});
      }
      return r;
    }).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html')))
  );
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const target=e.notification?.data?.url||'./';
  e.waitUntil(
    clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
      for(const c of list){
        if('focus' in c){
          if('navigate' in c && target)c.navigate(target).catch(()=>{});
          return c.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
