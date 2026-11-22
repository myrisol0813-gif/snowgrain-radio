// The push payload is intentionally empty. Never display private letter content.
self.addEventListener("push",(event)=>{
  event.waitUntil(self.registration.showNotification("雪粒电台收到新信号",{
    body:"有一封新的来信，请到值班室看看。",
    icon:"/assets/snake-mail.png",
    tag:"snowgrain-new-signal",
    renotify:true,
    data:{url:"/admin/"}
  }));
});
self.addEventListener("notificationclick",(event)=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const url=new URL("/admin/",self.location.origin).href;
    const clients=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    const existing=clients.find(client=>client.url.startsWith(url));
    if(existing){await existing.focus();return;}
    return self.clients.openWindow(url);
  })());
});
