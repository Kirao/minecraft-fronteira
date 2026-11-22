(function () {
  const lista = window.PARTICIPANTES || [];
  const grade = document.getElementById("grade");
  const contagem = document.getElementById("contagem");
  let status = {}; // { usuario: { avatar, live } }
  let filtro = "todos";

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

  function card(p) {
    const u = user(p);
    const st = status[u] || {};
    const live = !!st.live;
    const avatar = p.foto || st.avatar || AVATAR_PADRAO;
    const linkTwitch = u ? `https://twitch.tv/${u}` : null;

    const tag = live
      ? `<a class="tag on" href="${linkTwitch}" target="_blank" rel="noopener"><span class="ponto"></span> Twitch ao vivo</a>`
      : `<span class="tag off">Offline</span>`;

    const redes = Object.entries(p.redes || {})
      .filter(([k, v]) => ICONES[k] && v)
      .map(([k, v]) => `<a class="${k}" href="${esc(v)}" target="_blank" rel="noopener" title="${NOMES[k]}" aria-label="${NOMES[k]} de ${esc(p.nome)}"><i class="${ICONES[k]}"></i></a>`)
      .join("");

    return `
      <article class="card ${live ? "live" : ""}">
        <div class="avatar-wrap">
          <img class="avatar" src="${esc(avatar)}" alt="Foto de ${esc(p.nome)}" loading="lazy" onerror="this.src='${AVATAR_PADRAO}'" />
        </div>
        <h2 class="nome">${esc(p.nome)}</h2>
        ${tag}
        <div class="redes">${redes}</div>
      </article>`;
  }

  function render() {
    // quem está ao vivo aparece primeiro
    const ordenada = [...lista].sort((a, b) => (status[user(b)]?.live ? 1 : 0) - (status[user(a)]?.live ? 1 : 0));
    const visiveis = filtro === "live" ? ordenada.filter((p) => status[user(p)]?.live) : ordenada;

    grade.innerHTML = visiveis.length
      ? visiveis.map(card).join("")
      : `<p class="vazio">${filtro === "live" ? "Ninguém ao vivo agora." : "Nenhum participante cadastrado."}</p>`;

    const aoVivo = lista.filter((p) => status[user(p)]?.live).length;
    contagem.innerHTML = `${lista.length} participantes · <b>${aoVivo} ao vivo</b>`;
  }

  // consulta direta (usada quando a função /api não existe, ex.: abrindo o arquivo no PC)
  async function direto(users) {
    const out = {};
    await Promise.all(
      users.map(async (u) => {
        const [avatar, uptime] = await Promise.all([
          fetch(`https://decapi.me/twitch/avatar/${u}`).then((r) => r.text()).catch(() => ""),
          fetch(`https://decapi.me/twitch/uptime/${u}`).then((r) => r.text()).catch(() => ""),
        ]);
        out[u] = { avatar: avatar.startsWith("http") ? avatar.trim() : null, live: !!uptime && !/offline|not found|error/i.test(uptime) };
      })
    );
    return out;
  }

  async function atualizar() {
    const users = [...new Set(lista.map(user).filter(Boolean))];
    if (!users.length) return render();
    try {
      const r = await fetch(`/api/twitch?users=${users.join(",")}`);
      if (!r.ok) throw new Error();
      status = await r.json();
    } catch (e) {
      try { status = await direto(users); } catch (e2) {}
    }
    render();
  }

  // filtros
  document.querySelectorAll(".filtro").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(".filtro").forEach((x) => x.classList.remove("ativo"));
      b.classList.add("ativo");
      filtro = b.dataset.filtro;
      render();
    })
  );

  // modo claro / escuro
  const btnTema = document.getElementById("tema");
  const temaAtual = () =>
    document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const iconeTema = () => (btnTema.innerHTML = `<i class="fa-solid ${temaAtual() === "dark" ? "fa-sun" : "fa-moon"}"></i>`);
  btnTema.addEventListener("click", () => {
    const novo = temaAtual() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = novo;
    try { localStorage.setItem("tema", novo); } catch (e) {}
    iconeTema();
  });
  iconeTema();

  render();
  atualizar();
  setInterval(atualizar, 60000);
})();
