import { neon } from "@neondatabase/serverless";
import {
  CommunityError,
  createIntention,
  getStats,
  listIntentions,
  participantHash,
  prayForIntention,
  recordEvent,
  reportIntention,
} from "../src/lib/community.js";

// Uma função só para a Comunidade (economiza o limite de funções da Vercel). A ação vem em ?r=.
//   GET  ?r=stats              terços de hoje, novenas em grupo e metas
//   GET  ?r=intentions         mural (aceita &before=<id> e o cabeçalho X-Anon-Id)
//   POST ?r=event              { anonId, kind: 'terco' | 'novena', ref? }
//   POST ?r=intentions         { anonId, text, firstName? }
//   POST ?r=pray               { anonId, id }
//   POST ?r=report             { anonId, id }

const DEFAULT_ORIGINS = "https://oratio-daily-dev.vercel.app,http://localhost:5173";

function allowedOrigin(origin) {
  const list = (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(",").map((o) => o.trim());
  return origin && list.includes(origin) ? origin : null;
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded || "").split(",")[0].trim() || req.socket?.remoteAddress;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    throw new CommunityError(400, "Corpo da requisição inválido.");
  }
}

export default async function handler(req, res) {
  // Só o site do Oratio escreve aqui; a leitura das estatísticas é pública.
  const origin = allowedOrigin(req.headers.origin);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Anon-Id");

  if (req.method === "OPTIONS") return res.status(204).end();

  const route = String(req.query?.r ?? "");

  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não está definida.");
    const sql = neon(process.env.DATABASE_URL);

    if (req.method === "GET") {
      if (route === "stats") {
        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
        return res.status(200).json(await getStats(sql));
      }
      if (route === "intentions") {
        const anonId = req.headers["x-anon-id"];
        const participant = anonId ? participantHash(String(anonId)) : null;
        const before = req.query.before && /^\d{1,18}$/.test(String(req.query.before)) ? String(req.query.before) : null;
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json({ intentions: await listIntentions(sql, { participant, before }) });
      }
      throw new CommunityError(404, "Rota não encontrada.");
    }

    if (req.method !== "POST") throw new CommunityError(405, "Método não permitido.");
    // Escrita só a partir do site (navegadores sempre mandam Origin em POST com JSON).
    if (!origin) throw new CommunityError(403, "Origem não permitida.");

    const body = readBody(req);
    const participant = participantHash(body.anonId);
    res.setHeader("Cache-Control", "no-store");

    if (route === "event") {
      await recordEvent(sql, { kind: body.kind, ref: body.ref ?? "", participant, ip: clientIp(req) });
      return res.status(204).end();
    }
    if (route === "intentions") {
      const created = await createIntention(sql, {
        text: body.text,
        firstName: body.firstName,
        participant,
        ip: clientIp(req),
      });
      return res.status(201).json(created);
    }
    const ip = clientIp(req);
    if (route === "pray") return res.status(200).json(await prayForIntention(sql, { id: body.id, participant, ip }));
    if (route === "report") return res.status(200).json(await reportIntention(sql, { id: body.id, participant, ip }));

    throw new CommunityError(404, "Rota não encontrada.");
  } catch (err) {
    if (err instanceof CommunityError) return res.status(err.status).json({ error: err.message });
    console.error("Erro na comunidade:", err);
    return res.status(500).json({ error: "Erro interno na comunidade." });
  }
}
