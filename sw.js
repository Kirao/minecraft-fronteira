// Service worker: deixa o site abrir rápido e funcionar como app (até sem internet,
// mostrando a última versão salva). Status ao vivo e contador sempre vêm da rede.
const VERSAO = "fronteira-v27";
const BASICO = ["/", "/index.html", "/multistream.html", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/logo.webp"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(BASICO)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const mesmoSite = url.origin === location.origin;
  const fonte = /fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/.test(url.host);
  if (!mesmoSite && !fonte) return; // players/chat da Twitch etc.
  if (mesmoSite && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_vercel/"))) return;

  const imagem = /\.(webp|png|jpg|jpeg|svg|gif|woff2?)$/i.test(url.pathname) || fonte;
  if (imagem) {
    // imagens e fontes: usa a cópia salva, busca na rede só se não tiver
    e.respondWith(
      caches.match(req).then((salvo) => salvo || fetch(req).then((r) => {
        if (r.ok || r.type === "opaque") { const c = r.clone(); caches.open(VERSAO).then((cc) => cc.put(req, c)); }
        return r;
      }))
    );
    return;
  }

  // páginas, css e js: tenta a rede primeiro (pega novidades), usa a cópia se estiver offline
  e.respondWith(
    fetch(req).then((r) => {
      if (r.ok) { const c = r.clone(); caches.open(VERSAO).then((cc) => cc.put(req, c)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" }).then((s) => s || caches.match("/")))
  );
});
