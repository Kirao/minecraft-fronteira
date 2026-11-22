// Função da Vercel: /api/twitch
// Devolve a foto de perfil e se cada canal está ao vivo.
// Consulta SEMPRE a lista fixa de participantes.js (ignora nomes pedidos na URL),
// assim robôs não conseguem gastar a cota pedindo listas inventadas.
// Se TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET estiverem configurados na Vercel,
// usa a API oficial da Twitch. Senão, usa o serviço público decapi.me.

import { readFileSync } from "node:fs";

let CANAIS = [];
try {
  const txt = readFileSync(new URL("../participantes.js", import.meta.url), "utf8");
  CANAIS = [...new Set([...txt.matchAll(/\btwitch:\s*"([a-z0-9_]{2,25})"/gi)].map((m) => m[1].toLowerCase()))].sort();
} catch (e) {}

// último resultado completo na memória da função: segura rajadas de pedidos
let ultimoResultado = null; // { dados, quando }
const RESULTADO_VALE = 30 * 1000;

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

// Só conta como "ao vivo" se a resposta for um tempo de live (ex.: "1 hour, 3 minutes")
// e como offline se a resposta disser "offline". Qualquer outra coisa (erro, limite de
// requisições) é "desconhecido": tentamos de novo e, se continuar, usamos o último valor conhecido.
const EH_TEMPO = /\d+\s+(second|minute|hour|day)s?/i;
const memoria = {}; // { canal: { live, quando } } último status confirmado (vale só por 3 minutos)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultaUptime(u) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const txt = await fetch(`https://decapi.me/twitch/uptime/${encodeURIComponent(u)}`)
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => "");
    if (/offline/i.test(txt)) return false;
    if (EH_TEMPO.test(txt)) return true;
    await esperar(400 + tentativa * 600);
  }
  return null; // não deu pra saber
}

async function viaDecapi(users) {
  const out = {};
  let desconhecidos = 0;
  const fila = [...users];
  async function trabalhador() {
    while (fila.length) {
      const u = fila.shift();
      const live = await consultaUptime(u);
      if (live === null) {
        desconhecidos++;
        const m = memoria[u];
        out[u] = { avatar: null, live: !!(m && Date.now() - m.quando < 3 * 60 * 1000 && m.live) };
      } else {
        memoria[u] = { live, quando: Date.now() };
        out[u] = { avatar: null, live };
      }
    }
  }
  await Promise.all(Array.from({ length: 3 }, trabalhador)); // 3 por vez para não estourar o limite
  return { out, desconhecidos };
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
    res.setHeader("Cache-Control", "s-maxage=45, stale-while-revalidate=30");
    return res.status(200).json(ultimoResultado.dados);
  }

  try {
    const { TWITCH_CLIENT_ID: id, TWITCH_CLIENT_SECRET: secret } = process.env;
    if (id && secret) {
      const data = await viaHelix(users, id, secret);
      ultimoResultado = { dados: data, quando: Date.now() };
      res.setHeader("Cache-Control", pedeNovo ? "s-maxage=20" : "s-maxage=45, stale-while-revalidate=120");
      return res.status(200).json(data);
    }
    const { out, desconhecidos } = await viaDecapi(users);
    if (!desconhecidos) ultimoResultado = { dados: out, quando: Date.now() };
    // resposta completa fica no cache da Vercel (todo mundo vê a mesma);
    // se faltou algum canal, guarda só 10s para tentar de novo logo
    if (pedeNovo) res.setHeader("Cache-Control", "s-maxage=20");
    else res.setHeader("Cache-Control", desconhecidos ? "s-maxage=10" : "s-maxage=45, stale-while-revalidate=30");
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "falha ao consultar a Twitch" });
  }
}
