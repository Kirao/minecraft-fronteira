(function () {
  const lista = window.PARTICIPANTES || [];
  const grade = document.getElementById("grade");
  const contagem = document.getElementById("contagem");
  const busca = document.getElementById("busca");
  let status = {}; // { usuario: { avatar, live } }
  let carregou = false;
  let soLive = false;
  const btnLive = document.getElementById("so-live");
  btnLive?.addEventListener("click", () => {
    soLive = !soLive;
    btnLive.classList.toggle("ativo", soLive);
    btnLive.setAttribute("aria-pressed", soLive);
    render();
  });

  const ICONES = {
    twitch: "fa-brands fa-twitch",
    youtube: "fa-brands fa-youtube",
    kick: "fa-brands fa-kickstarter-k",
    tiktok: "fa-brands fa-tiktok",
    instagram: "fa-brands fa-instagram",
    x: "fa-brands fa-x-twitter",
    discord: "fa-brands fa-discord",
  };
  const NOMES = { twitch: "Twitch", youtube: "YouTube", kick: "Kick", tiktok: "TikTok", instagram: "Instagram", x: "X", discord: "Discord" };

  const AVATAR_PADRAO =
    "data:image/svg+xml;utf8," +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect width="8" height="8" fill="#6b4a2b"/><rect y="0" width="8" height="2" fill="#3b2a1a"/><rect x="1" y="3" width="2" height="1" fill="#fff"/><rect x="5" y="3" width="2" height="1" fill="#fff"/><rect x="2" y="3" width="1" height="1" fill="#3a5fcd"/><rect x="5" y="3" width="1" height="1" fill="#3a5fcd"/><rect x="2" y="5" width="4" height="1" fill="#3b2a1a"/></svg>');

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const user = (p) => (p.twitch || "").trim().toLowerCase();
  const aoVivo = (p) => !!status[user(p)]?.live;

  function card(p) {
    const u = user(p);
    const live = aoVivo(p);
    const avatar = p.foto || status[u]?.avatar || AVATAR_PADRAO;

    // capa: arte própria (campo "capa") ou a foto em círculo sobre um fundo desfocado
    const capa = p.capa
      ? `<img class="foto arte" src="${esc(p.capa)}" alt="${esc(p.personagem || p.nome)}" loading="lazy" />`
      : `<img class="blur" src="${esc(avatar)}" alt="" aria-hidden="true" />
         <img class="foto avatar" src="${esc(avatar)}" alt="Foto de ${esc(p.nome)}" onerror="this.src='${AVATAR_PADRAO}'" />`;

    const selo = live
      ? `<a class="selo-live" href="multistream.html?c=${u}" title="Assistir aqui no site"><img src="ui/aovivo_gema.webp" alt="Ao vivo" width="385" height="125" /></a>`
      : "";

    // "youtube2", "twitch2"... usam o mesmo ícone da rede
    const redes = Object.entries(p.redes || {})
      .map(([k, v]) => [k.replace(/\d+$/, ""), v])
      .filter(([k, v]) => ICONES[k] && v)
      .map(([k, v]) => `<a class="${k}" href="${esc(v)}" target="_blank" rel="noopener" title="${NOMES[k]}${k === "twitch" && live ? " (ao vivo)" : ""}" aria-label="${NOMES[k]} de ${esc(p.nome)}"><i class="${ICONES[k]}"></i></a>`)
      .join("");

    return `
      <article class="card ${live ? "live" : ""}">
        ${selo}
        ${p.desaparecido && !live ? `<div class="desaparecido" tabindex="0"><img src="ui/desaparecido.webp" alt="Desaparecido" /><span class="balao-des">Sumiu do mapa! Faz um tempinho que não loga no servidor... se alguém achar, avisa a guilda 👀</span></div>` : ""}
        <div class="capa">${capa}</div>
        <h3 class="nome">${esc(p.personagem || p.nome)}</h3>
        ${p.personagem && p.personagem.toLowerCase() !== p.nome.toLowerCase() ? `<p class="criador">${esc(p.nome)}</p>` : ""}
        <div class="redes">${redes}</div>
      </article>`;
  }

  function render() {
    const termo = (busca?.value || "").trim().toLowerCase();
    const ordenada = [...lista]
      .filter((p) => !termo || [p.nome, p.personagem || "", user(p)].some((t) => t.toLowerCase().includes(termo)))
      .filter((p) => !soLive || aoVivo(p))
      .sort((a, b) => (a.personagem || a.nome).localeCompare(b.personagem || b.nome, "pt-BR", { sensitivity: "base" }));

    grade.innerHTML = ordenada.length
      ? ordenada.map(card).join("")
      : `<p class="vazio">${soLive ? (carregou ? "Ninguém da série está ao vivo agora." : "Verificando quem está ao vivo...") : termo ? "Nenhum criador encontrado." : "Nenhum criador cadastrado ainda."}</p>`;

    const vivos = lista.filter(aoVivo).length;
    contagem.innerHTML = carregou
      ? `${lista.length} criadores · <b>${vivos} ao vivo agora</b>`
      : `${lista.length} criadores · <i class="fa-solid fa-spinner fa-spin"></i> verificando quem está ao vivo...`;
  }

  // consulta direta (quando a função /api não existe, ex.: abrindo o arquivo no PC)
  async function direto(users) {
    const out = {};
    const fila = [...users];
    const EH_TEMPO = /\d+\s+(second|minute|hour|day)s?/i;
    async function trabalhador() {
      while (fila.length) {
        const u = fila.shift();
        const uptime = await fetch(`https://decapi.me/twitch/uptime/${u}`).then((r) => (r.ok ? r.text() : "")).catch(() => "");
        out[u] = { avatar: null, live: EH_TEMPO.test(uptime) && !/offline/i.test(uptime) };
      }
    }
    await Promise.all(Array.from({ length: 4 }, trabalhador));
    return out;
  }

  async function atualizar(forcar = false) {
    const users = [...new Set(lista.map(user).filter(Boolean))];
    if (!users.length) return render();
    try {
      const r = await fetch(`/api/twitch?users=${users.join(",")}` + (forcar ? `&fresh=${Date.now()}` : ""), forcar ? { cache: "no-store" } : {});
      if (!r.ok) throw new Error();
      status = await r.json();
      carregou = true;
    } catch (e) {
      try { status = await direto(users); carregou = true; } catch (e2) {}
    }
    render();
  }

  busca?.addEventListener("input", render);

  render();
  atualizar();
  setInterval(() => atualizar(), 60000);

  // pop-up de aviso (some sozinho)
  function toast(sub) {
    document.querySelector(".toast")?.remove();
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i><div><b>Informações atualizadas!</b><span>${sub}</span></div>`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("on"));
    setTimeout(() => { t.classList.remove("on"); setTimeout(() => t.remove(), 400); }, 3500);
  }

  // botão "Atualizar": faz uma checagem nova agora, sem cache
  const btnAtt = document.getElementById("atualizar");
  btnAtt?.addEventListener("click", async () => {
    if (btnAtt.disabled) return;
    btnAtt.disabled = true;
    btnAtt.classList.add("girando");
    await atualizar(true);
    btnAtt.classList.remove("girando");
    const n = lista.filter(aoVivo).length;
    toast(n ? `${n} ${n === 1 ? "criador está" : "criadores estão"} ao vivo agora` : "Ninguém da série está ao vivo agora");
    setTimeout(() => (btnAtt.disabled = false), 5000); // evita cliques seguidos
  });
})();
