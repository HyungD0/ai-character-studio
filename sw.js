// 앱 설치(PWA)용 서비스 워커.
// 항상 인터넷에서 최신 파일을 먼저 받고, 오프라인일 때만 마지막으로 받은 파일을 보여 줍니다.
// (캐시를 먼저 쓰면 새로 배포해도 옛 화면이 남는 문제가 생겨서 쓰지 않음)
const CACHE = "aics-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return; // 외부(AI·Firebase·통계)는 손대지 않음
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("./"))),
  );
});
