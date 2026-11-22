// Função da Vercel: /api/online?id=<visitante>  -> { online: N }
// Cada aba aberta do site manda um "estou aqui" a cada 25s. Quem some por
// mais de 70s deixa de contar. ?sair=1 tira o visitante na hora (fechou a aba).
//
// Se o Redis (Upstash) estiver ligado no projeto da Vercel, usa ele (conta certa
// mesmo com muitos servidores). Senão, guarda na memória da própria função.

const TTL = 70 * 1000;
const CHAVE = "fronteira:online";
const memoria = new Map(); // id -> último sinal (ms)

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function viaRedis(id, sair) {
  const agora = Date.now();
  const cmds = [["ZREMRANGEBYSCORE", CHAVE, "0", String(agora - TTL)]];
  if (id) cmds.push(sair ? ["ZREM", CHAVE, id] : ["ZADD", CHAVE, String(agora), id]);
  cmds.push(["ZCARD", CHAVE], ["EXPIRE", CHAVE, "600"]);
  const r = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  const res = await r.json();
  return Number(res[res.length - 2].result) || 0;
}

function viaMemoria(id, sair) {
  const agora = Date.now();
  if (id) sair ? memoria.delete(id) : memoria.set(id, agora);
  for (const [k, t] of memoria) if (agora - t > TTL) memoria.delete(k);
  return memoria.size;
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const id = (url.searchParams.get("id") || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  const sair = url.searchParams.get("sair") === "1";

  let online;
  if (REDIS_URL && REDIS_TOKEN) {
    try { online = await viaRedis(id, sair); } catch (e) { online = viaMemoria(id, sair); }
  } else {
    online = viaMemoria(id, sair);
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).send(JSON.stringify({ online: Math.max(online, id && !sair ? 1 : 0) }));
}
