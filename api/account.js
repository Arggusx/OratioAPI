import { neon } from "@neondatabase/serverless";
import { AuthError, createSession, readSession, verifyGoogleIdToken } from "../src/lib/auth.js";

// Conta do Oratio (uma função só, para economizar o limite de funções da Vercel). A ação vem em ?r=.
//   POST   ?r=login        { credential }   ID token do "Entrar com Google" → { token, user, progress }
//   GET    ?r=me                            → { user, progress }
//   PUT    ?r=progress     { data }         guarda o progresso da Jornada → { updatedAt }
//   PATCH  ?r=preferences  { wantsMessages } aceite das mensagens por e-mail → { user }
//   DELETE ?r=account                       apaga a conta e o progresso
// Todas, menos o login, pedem "Authorization: Bearer <token>".

const DEFAULT_ORIGINS = "https://www.oratiodaily.com,https://oratiodaily.com,http://localhost:5173";
const MAX_PROGRESS_BYTES = 200_000;

function allowedOrigin(origin) {
  const list = (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(",").map((o) => o.trim());
  return origin && list.includes(origin) ? origin : null;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    throw new AuthError(400, "Corpo da requisição inválido.");
  }
}

const publicUser = (row) => ({ name: row.name, email: row.email, wantsMessages: row.wants_messages });

async function loadProgress(sql, userId) {
  const rows = await sql`SELECT data, updated_at FROM user_progress WHERE user_id = ${userId}`;
  return rows[0] ? { data: rows[0].data, updatedAt: rows[0].updated_at } : null;
}

export default async function handler(req, res) {
  const origin = allowedOrigin(req.headers.origin);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();

  const route = String(req.query?.r ?? "");

  try {
    // Só o site do Oratio fala com a conta.
    if (!origin) throw new AuthError(403, "Origem não permitida.");
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não está definida.");
    const sql = neon(process.env.DATABASE_URL);

    if (route === "login" && req.method === "POST") {
      const { credential } = readBody(req);
      const google = await verifyGoogleIdToken(credential);
      const name = google.name ? String(google.name).slice(0, 80) : null;
      const [user] = await sql`
        INSERT INTO app_users (google_sub, email, name)
        VALUES (${google.sub}, ${google.email}, ${name})
        ON CONFLICT (google_sub) DO UPDATE
          SET email = EXCLUDED.email, name = COALESCE(EXCLUDED.name, app_users.name), last_login_at = now()
        RETURNING id, name, email, wants_messages`;
      return res.status(200).json({
        token: createSession(user.id),
        user: publicUser(user),
        progress: await loadProgress(sql, user.id),
      });
    }

    const userId = readSession(req.headers.authorization);
    const [user] = await sql`SELECT id, name, email, wants_messages FROM app_users WHERE id = ${userId}`;
    if (!user) throw new AuthError(401, "Conta não encontrada. Entre de novo.");

    if (route === "me" && req.method === "GET") {
      return res.status(200).json({ user: publicUser(user), progress: await loadProgress(sql, user.id) });
    }

    if (route === "progress" && req.method === "PUT") {
      const { data } = readBody(req);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new AuthError(400, "Progresso inválido.");
      const json = JSON.stringify(data);
      if (Buffer.byteLength(json) > MAX_PROGRESS_BYTES) throw new AuthError(413, "Progresso grande demais.");
      const [row] = await sql`
        INSERT INTO user_progress (user_id, data, updated_at) VALUES (${user.id}, ${json}::jsonb, now())
        ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
        RETURNING updated_at`;
      return res.status(200).json({ updatedAt: row.updated_at });
    }

    if (route === "preferences" && req.method === "PATCH") {
      const { wantsMessages } = readBody(req);
      if (typeof wantsMessages !== "boolean") throw new AuthError(400, "Preferência inválida.");
      const [row] = await sql`
        UPDATE app_users SET wants_messages = ${wantsMessages} WHERE id = ${user.id}
        RETURNING id, name, email, wants_messages`;
      return res.status(200).json({ user: publicUser(row) });
    }

    if (route === "account" && req.method === "DELETE") {
      await sql`DELETE FROM app_users WHERE id = ${user.id}`;
      return res.status(204).end();
    }

    throw new AuthError(404, "Rota não encontrada.");
  } catch (err) {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
    console.error("Erro na conta:", err);
    return res.status(500).json({ error: "Erro interno na conta." });
  }
}
