// Função da Vercel: /api/twitch?users=nome1,nome2
// Devolve a foto de perfil e se cada canal está ao vivo.
// Se TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET estiverem configurados na Vercel,
// usa a API oficial da Twitch. Senão, usa o serviço público decapi.me.

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
  const users = String(req.query.users || "")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter((u) => /^[a-z0-9_]{2,25}$/.test(u))
    .slice(0, 100);

  if (!users.length) return res.status(200).json({});

  try {
    const { TWITCH_CLIENT_ID: id, TWITCH_CLIENT_SECRET: secret } = process.env;
    if (id && secret) {
      const data = await viaHelix(users, id, secret);
      res.setHeader("Cache-Control", "s-maxage=45, stale-while-revalidate=120");
      return res.status(200).json(data);
    }
    const { out, desconhecidos } = await viaDecapi(users);
    // resposta completa fica 60s no cache da Vercel (todo mundo vê a mesma);
    // se faltou algum canal, guarda só 10s para tentar de novo logo
    if (req.query.fresh) res.setHeader("Cache-Control", "no-store");
    else res.setHeader("Cache-Control", desconhecidos ? "s-maxage=10" : "s-maxage=45, stale-while-revalidate=30");
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "falha ao consultar a Twitch" });
  }
}
