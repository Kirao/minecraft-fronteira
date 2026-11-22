(function () {
  const lista = (window.PARTICIPANTES || []).filter((p) => p.twitch);
  const porUser = Object.fromEntries(lista.map((p) => [p.twitch.toLowerCase(), p]));
  const PARENT = location.hostname; // a Twitch exige o domínio do site no embed

  const elLista = document.getElementById("lista-live");
  const elDica = document.getElementById("dica");
  const elTelas = document.getElementById("telas");
  const elChat = document.getElementById("chat");
  const elChatAbas = document.getElementById("chat-abas");
  const elChatFrame = document.getElementById("chat-frame");
  const btnChat = document.getElementById("btn-chat");
  const btnLink = document.getElementById("btn-link");

  const params = new URLSearchParams(location.search);
  let selecionados = (params.get("c") || "").split(",").map((s) => s.trim().toLowerCase()).filter((u) => porUser[u]);
  let aoVivo = [];
  let chatDe = selecionados[0] || null;
  let chatAberto = params.get("chat") !== "0" && window.innerWidth > 700;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nome = (u) => porUser[u]?.personagem || porUser[u]?.nome || u;
  const foto = (u) => porUser[u]?.capa || porUser[u]?.foto || "favicon.png";

  function salvarUrl() {
    const q = new URLSearchParams();
    if (selecionados.length) q.set("c", selecionados.join(","));
    if (!chatAberto) q.set("chat", "0");
    history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : ""));
  }

  function desenharLista() {
    const ordem = [...aoVivo].sort((a, b) => nome(a).localeCompare(nome(b), "pt-BR", { sensitivity: "base" }));
    elDica.textContent = ordem.length
      ? `${ordem.length} ao vivo agora. Clique para adicionar ou tirar da tela.`
      : "Ninguém da série está ao vivo agora. Volte mais tarde!";
    elLista.innerHTML = ordem
      .map((u) => `
        <button class="chip ${selecionados.includes(u) ? "on" : ""}" data-u="${esc(u)}" title="${esc(porUser[u].nome)}">
          <img src="${esc(foto(u))}" alt="" />
          <span class="ponto"></span>${esc(nome(u))}
          <i class="fa-solid fa-check check"></i>
        </button>`)
      .join("");
  }

  // só recria os players que mudaram, para não reiniciar quem já está tocando
  function desenharTelas() {
    const n = selecionados.length;
    elTelas.className = "telas " + (n > 6 ? "nmuitos" : "n" + Math.max(n, 1));
    const atuais = new Map([...elTelas.querySelectorAll(".tela")].map((t) => [t.dataset.u, t]));
    atuais.forEach((t, u) => { if (!selecionados.includes(u)) t.remove(); });
    elTelas.querySelector(".vazio-palco")?.remove();

    selecionados.forEach((u, i) => {
      let t = atuais.get(u);
      if (!t) {
        t = document.createElement("div");
        t.className = "tela";
        t.dataset.u = u;
        t.innerHTML = `
          <div class="barra-tela">
            <button data-acao="chat" title="Ver o chat de ${esc(nome(u))}"><i class="fa-solid fa-comments"></i></button>
            <button data-acao="sair" title="Tirar da tela"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <iframe src="https://player.twitch.tv/?channel=${encodeURIComponent(u)}&parent=${PARENT}&muted=${i === 0 ? "false" : "true"}"
            allowfullscreen allow="autoplay; fullscreen" title="Live de ${esc(nome(u))}"></iframe>`;
        elTelas.appendChild(t); // só adiciona as novas; mover um iframe faria ele recarregar
      }
    });

    if (!n) {
      elTelas.innerHTML = `<div class="vazio-palco"><i class="fa-solid fa-tv"></i><br>Escolha uma ou mais lives acima para assistir aqui.</div>`;
    }
    desenharChat();
  }

  function desenharChat() {
    if (chatDe && !selecionados.includes(chatDe)) chatDe = selecionados[0] || null;
    if (!chatDe) chatDe = selecionados[0] || null;
    const mostrar = chatAberto && !!chatDe;
    elChat.hidden = !mostrar;
    btnChat.classList.toggle("ativo", chatAberto);
    if (!mostrar) return;
    elChatAbas.innerHTML = selecionados
      .map((u) => `<button class="${u === chatDe ? "ativa" : ""}" data-u="${esc(u)}">${esc(nome(u))}</button>`)
      .join("");
    const src = `https://www.twitch.tv/embed/${encodeURIComponent(chatDe)}/chat?parent=${PARENT}&darkpopout`;
    if (elChatFrame.getAttribute("src") !== src) elChatFrame.setAttribute("src", src);
  }

  function alternar(u) {
    selecionados = selecionados.includes(u) ? selecionados.filter((x) => x !== u) : [...selecionados, u];
    salvarUrl();
    desenharLista();
    desenharTelas();
  }

  elLista.addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (b) alternar(b.dataset.u);
  });
  elTelas.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-acao]");
    if (!b) return;
    const u = b.closest(".tela").dataset.u;
    if (b.dataset.acao === "sair") alternar(u);
    if (b.dataset.acao === "chat") { chatDe = u; chatAberto = true; salvarUrl(); desenharChat(); }
  });
  elChatAbas.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-u]");
    if (b) { chatDe = b.dataset.u; desenharChat(); }
  });
  btnChat.addEventListener("click", () => { chatAberto = !chatAberto; salvarUrl(); desenharChat(); });
  btnLink.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      btnLink.innerHTML = '<i class="fa-solid fa-check"></i> Copiado!';
    } catch (e) {
      btnLink.innerHTML = '<i class="fa-solid fa-xmark"></i> Não deu';
    }
    setTimeout(() => (btnLink.innerHTML = '<i class="fa-solid fa-link"></i> Copiar link'), 2000);
  });

  async function atualizar() {
    const users = Object.keys(porUser);
    try {
      const r = await fetch(`/api/twitch?users=${users.join(",")}`);
      const status = await r.json();
      aoVivo = users.filter((u) => status[u]?.live);
    } catch (e) {
      aoVivo = [];
    }
    // na primeira vez, se não veio nada no link, já abre as 2 primeiras lives
    if (!atualizar.feito && !selecionados.length && aoVivo.length) {
      selecionados = [...aoVivo].sort((a, b) => nome(a).localeCompare(nome(b), "pt-BR")).slice(0, 2);
      chatDe = selecionados[0];
      salvarUrl();
    }
    atualizar.feito = true;
    desenharLista();
    desenharTelas();
  }

  desenharTelas();
  atualizar();
  setInterval(atualizar, 60000);
})();
