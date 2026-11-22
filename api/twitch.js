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

// Só conta como "ao vivo" se a resposta for um tempo de live (ex.: "1 hour, 3 minutes").
// Qualquer outra resposta (offline, erro, limite de requisições) conta como offline.
const EH_TEMPO = /\d+\s+(second|minute|hour|day)s?/i;

async function viaDecapi(users) {
  const out = {};
  const fila = [...users];
  async function trabalhador() {
    while (fila.length) {
      const u = fila.shift();
      const uptime = await fetch(`https://decapi.me/twitch/uptime/${encodeURIComponent(u)}`)
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => "");
      out[u] = { avatar: null, live: EH_TEMPO.test(uptime) && !/offline/i.test(uptime) };
    }
  }
  await Promise.all(Array.from({ length: 4 }, trabalhador)); // 4 por vez para não estourar o limite
  return out;
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
    const data = id && secret ? await viaHelix(users, id, secret) : await viaDecapi(users);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: "falha ao consultar a Twitch" });
  }
}
