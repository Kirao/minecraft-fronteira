// Função da Vercel: /api/twitch
// Devolve a foto de perfil e se cada canal está ao vivo.
// Consulta SEMPRE a lista fixa de participantes.js (ignora nomes pedidos na URL),
// assim robôs não conseguem gastar a cota pedindo listas inventadas.
// Se TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET estiverem configurados na Vercel,
// usa a API oficial da Twitch. Senão, usa a prévia pública da live (e o decapi.me de reserva).

import { readFileSync } from "node:fs";

let CANAIS = [];
try {
  const txt = readFileSync(new URL("../participantes.js", import.meta.url), "utf8");
  CANAIS = [...new Set([...txt.matchAll(/\btwitch:\s*"([a-z0-9_]{2,25})"/gi)].map((m) => m[1].toLowerCase()))].sort();
} catch (e) {}

// último resultado completo na memória da função: segura rajadas de pedidos
let ultimoResultado = null; // { dados, quando }
const RESULTADO_VALE = 20 * 1000;

let cachedToken = null;

async function getToken(id, secret) {
  if (cachedToken && cachedToken.exp > Date.now()) return cachedToken.value;
  const r = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`,
    { method: "POST" }
  );
  const j = await r.json();
  cachedToken = { value: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return cachedToken.value;
}

async function viaHelix(users, id, secret) {
  const token = await getToken(id, secret);
  const headers = { "Client-Id": id, Authorization: `Bearer ${token}` };
  const q = users.map((u) => `login=${encodeURIComponent(u)}`).join("&");
  const q2 = users.map((u) => `user_login=${encodeURIComponent(u)}`).join("&");
  const [usersRes, streamsRes] = await Promise.all([
    fetch(`https://api.twitch.tv/helix/users?${q}`, { headers }).then((r) => r.json()),
    fetch(`https://api.twitch.tv/helix/streams?${q2}`, { headers }).then((r) => r.json()),
  ]);
  const out = {};
  for (const u of users) out[u] = { avatar: null, live: false };
  for (const u of usersRes.data || []) {
    out[u.login] = { ...out[u.login], avatar: u.profile_image_url };
  }
  for (const s of streamsRes.data || []) {
    out[s.user_login] = { ...out[s.user_login], live: true, title: s.title, viewers: s.viewer_count, game: s.game_name };
  }
  return out;
}

// ---------- sem chaves da Twitch ----------
// Fonte principal: a imagem de prévia da live no servidor de imagens da própria Twitch.
// Canal ao vivo -> a imagem existe (200). Offline -> redireciona para "404_preview".
// É rápido (~0,1s) e não tem limite de pedidos. O tamanho da imagem muda a cada minuto
// para não pegar uma resposta velha guardada no cache da Twitch.
// Reserva: o decapi.me (lento e às vezes falha). Se as duas falharem, usa o último
// status confirmado (até 10 min).
const EH_TEMPO = /\d+\s+(second|minute|hour|day)s?/i;
const memoria = {}; // { canal: { live, quando } }

async function viaPrevia(u) {
  const largura = 1 + (Math.floor(Date.now() / 60000) % 60);
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const r = await fetch(`https://static-cdn.jtvnw.net/previews-ttv/live_user_${u}-${largura}x1.jpg`, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(3000),
      });
      if (r.status === 200) return true;
      if (r.status >= 300 && r.status < 400 && /404_preview/.test(r.headers.get("location") || "")) return false;
    } catch (e) {}
  }
  return null;
}

async function viaDecapiUm(u) {
  const txt = await fetch(`https://decapi.me/twitch/uptime/${encodeURIComponent(u)}`, { signal: AbortSignal.timeout(6000) })
    .then((r) => (r.ok ? r.text() : ""))
    .catch(() => "");
  if (/offline/i.test(txt)) return false;
  if (EH_TEMPO.test(txt)) return true;
  return null;
}

async function viaPublico(users) {
  const out = {};
  let desconhecidos = 0;
  await Promise.all(
    users.map(async (u) => {
      let live = await viaPrevia(u);
      if (live === null) live = await viaDecapiUm(u);
      if (live === null) {
        desconhecidos++;
        const m = memoria[u];
        out[u] = { avatar: null, live: !!(m && Date.now() - m.quando < 10 * 60 * 1000 && m.live) };
      } else {
        memoria[u] = { live, quando: Date.now() };
        out[u] = { avatar: null, live };
      }
    })
  );
  await espectadores(out);
  return { out, desconhecidos };
}

// quantas pessoas assistem cada live (só para quem está ao vivo, poucos canais).
// Vem do decapi (às vezes lento): limite de 8s; se falhar, usa o último número (10 min).
const ultimosViewers = {}; // { canal: { n, quando } }
async function espectadores(out) {
  const vivos = Object.keys(out).filter((u) => out[u].live);
  await Promise.all(
    vivos.map(async (u) => {
      const txt = await fetch(`https://decapi.me/twitch/viewercount/${encodeURIComponent(u)}`, { signal: AbortSignal.timeout(8000) })
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => "");
      const n = /^\s*\d+\s*$/.test(txt) ? Number(txt) : null;
      if (n !== null) ultimosViewers[u] = { n, quando: Date.now() };
      const m = ultimosViewers[u];
      if (m && Date.now() - m.quando < 10 * 60 * 1000) out[u].viewers = m.n;
    })
  );
}

export default async function handler(req, res) {
  // lista fixa. Só se participantes.js não carregou, aceita a do pedido (nomes válidos, máx. 60).
  let users = CANAIS;
  if (!users.length) {
    users = String(req.query.users || "")
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .filter((u) => /^[a-z0-9_]{2,25}$/.test(u))
      .slice(0, 60);
  }
  if (!users.length) return res.status(200).json({});

  // botão "Atualizar": ?fresh=<bloco de 20s>. Só vale o bloco atual, então todo mundo
  // que apertar no mesmo bloco divide a mesma resposta do cache.
  const bloco = Math.floor(Date.now() / 20000);
  const fresh = Number(req.query.fresh);
  const pedeNovo = fresh === bloco || fresh === bloco - 1;

  if (!pedeNovo && ultimoResultado && Date.now() - ultimoResultado.quando < RESULTADO_VALE) {
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=300");
    return res.status(200).json(ultimoResultado.dados);
  }

  try {
    const { TWITCH_CLIENT_ID: id, TWITCH_CLIENT_SECRET: secret } = process.env;
    if (id && secret) {
      const data = await viaHelix(users, id, secret);
      ultimoResultado = { dados: data, quando: Date.now() };
      res.setHeader("Cache-Control", pedeNovo ? "s-maxage=20" : "s-maxage=30, stale-while-revalidate=300");
      return res.status(200).json(data);
    }
    const { out, desconhecidos } = await viaPublico(users);
    if (!desconhecidos) ultimoResultado = { dados: out, quando: Date.now() };
    // resposta fica no cache da Vercel (todo mundo vê a mesma). stale-while-revalidate:
    // depois de um tempo parado, o próximo visitante recebe a última resposta na hora
    // e a Vercel atualiza por trás (o decapi é lento, ninguém fica esperando);
    // se faltou algum canal, guarda só 10s para tentar de novo logo
    if (pedeNovo) res.setHeader("Cache-Control", "s-maxage=20");
    else res.setHeader("Cache-Control", desconhecidos ? "s-maxage=10, stale-while-revalidate=60" : "s-maxage=30, stale-while-revalidate=300");
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "falha ao consultar a Twitch" });
  }
}
