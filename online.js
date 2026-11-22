// Contador "pessoas no site agora" (canto da tela) + botão de instalar o app.
(function () {
  // ---------- contador de pessoas online ----------
  let id;
  try {
    id = localStorage.getItem("fronteira-id");
    if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("fronteira-id", id); }
  } catch (e) { id = Math.random().toString(36).slice(2); }

  const box = document.createElement("div");
  box.className = "online-agora";
  box.setAttribute("role", "status");
  box.title = "Pessoas com o site aberto agora";
  box.innerHTML = `<span class="pulso" aria-hidden="true"></span><i class="fa-solid fa-users" aria-hidden="true"></i><b id="online-n">…</b><span class="rotulo">no site agora</span>`;
  document.body.appendChild(box);
  const num = box.querySelector("#online-n");

  let ultimo = null;
  async function sinal() {
    if (document.hidden) return;
    try {
      const r = await fetch(`/api/online?id=${id}`, { cache: "no-store" });
      if (!r.ok) throw 0;
      const { online } = await r.json();
      if (online !== ultimo) {
        num.textContent = online;
        box.querySelector(".rotulo").textContent = online === 1 ? "pessoa no site" : "pessoas no site";
        box.classList.remove("pula"); void box.offsetWidth; box.classList.add("pula");
        ultimo = online;
      }
      box.classList.add("on");
    } catch (e) {
      box.classList.toggle("on", ultimo !== null);
    }
  }
  sinal();
  setInterval(sinal, 25000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) navigator.sendBeacon?.(`/api/online?id=${id}&sair=1`);
    else sinal();
  });
  addEventListener("pagehide", () => navigator.sendBeacon?.(`/api/online?id=${id}&sair=1`));

  // ---------- app (PWA) ----------
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  const instalado = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (instalado) return;

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let pedido = null;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "instalar-app";
  btn.innerHTML = `<i class="fa-solid fa-mobile-screen-button"></i> Instalar app`;
  btn.hidden = true;
  document.body.appendChild(btn);

  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); pedido = e; btn.hidden = false; });
  addEventListener("appinstalled", () => { btn.hidden = true; });
  if (ios) btn.hidden = false;

  btn.addEventListener("click", async () => {
    if (pedido) {
      pedido.prompt();
      const { outcome } = await pedido.userChoice;
      if (outcome === "accepted") btn.hidden = true;
      pedido = null;
      return;
    }
    // iPhone: não tem botão automático, então explica o caminho
    document.querySelector(".dica-ios")?.remove();
    const d = document.createElement("div");
    d.className = "toast dica-ios on";
    d.innerHTML = `<i class="fa-solid fa-arrow-up-from-bracket"></i><div><b>Instalar no iPhone</b><span>Toque em <b class="inline">Compartilhar</b> e depois em <b class="inline">Adicionar à Tela de Início</b>.</span></div>`;
    document.body.appendChild(d);
    setTimeout(() => { d.classList.remove("on"); setTimeout(() => d.remove(), 400); }, 7000);
  });
})();
