import { createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";

// Login com Google: o site recebe do Google um "ID token" (JWT assinado) e manda para cá.
// Conferimos a assinatura com as chaves públicas do Google, o público (nosso Client ID) e a validade.
// Nenhuma senha passa pelo Oratio.

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const SESSION_DAYS = 30;

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const b64urlJson = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

let certCache = { keys: null, expiresAt: 0 };

async function googleKeys(fetchImpl) {
  if (certCache.keys && Date.now() < certCache.expiresAt) return certCache.keys;
  const res = await fetchImpl(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Chaves do Google indisponíveis (HTTP ${res.status}).`);
  const { keys } = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1] || 3600);
  certCache = { keys, expiresAt: Date.now() + Math.min(maxAge, 6 * 3600) * 1000 };
  return keys;
}

/** Confere o ID token do Google e devolve { sub, email, name }. */
export async function verifyGoogleIdToken(credential, { clientId = process.env.GOOGLE_CLIENT_ID, fetchImpl = fetch, now = Date.now() } = {}) {
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID não está definida.");
  if (typeof credential !== "string" || credential.length > 4096) throw new AuthError(400, "Login inválido.");

  const parts = credential.split(".");
  if (parts.length !== 3) throw new AuthError(400, "Login inválido.");

  let header, payload;
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    throw new AuthError(400, "Login inválido.");
  }
  if (header.alg !== "RS256" || !header.kid) throw new AuthError(401, "Login inválido.");

  let keys = await googleKeys(fetchImpl);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // O Google troca as chaves de tempos em tempos: busca de novo uma vez.
    certCache = { keys: null, expiresAt: 0 };
    keys = await googleKeys(fetchImpl);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new AuthError(401, "Login inválido.");

  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(parts[2], "base64url")
  );
  if (!valid) throw new AuthError(401, "Login inválido.");

  const nowSec = Math.floor(now / 1000);
  if (!GOOGLE_ISSUERS.has(payload.iss)) throw new AuthError(401, "Login inválido.");
  if (payload.aud !== clientId) throw new AuthError(401, "Login inválido.");
  if (typeof payload.exp !== "number" || payload.exp < nowSec - 60) throw new AuthError(401, "O login expirou. Entre de novo.");
  if (!payload.sub || !payload.email) throw new AuthError(401, "Login inválido.");
  if (payload.email_verified === false) throw new AuthError(401, "Confirme o seu e-mail no Google antes de entrar.");

  return { sub: String(payload.sub), email: String(payload.email), name: payload.given_name || payload.name || null };
}

function sessionSecret() {
  const key = process.env.SESSION_SECRET;
  if (!key || key.length < 32) throw new Error("SESSION_SECRET não está definida (mínimo 32 caracteres).");
  return key;
}

const sign = (data) => createHmac("sha256", sessionSecret()).update(data).digest("base64url");

/** Sessão sem estado: { uid, exp } assinado com HMAC. Vale 30 dias. */
export function createSession(userId, { now = Date.now() } = {}) {
  const data = Buffer.from(JSON.stringify({ uid: String(userId), exp: Math.floor(now / 1000) + SESSION_DAYS * 86400 })).toString("base64url");
  return `${data}.${sign(data)}`;
}

/** Lê o cabeçalho "Authorization: Bearer ..." e devolve o id do usuário, ou lança 401. */
export function readSession(authHeader, { now = Date.now() } = {}) {
  const token = /^Bearer (.+)$/.exec(authHeader || "")?.[1];
  if (!token) throw new AuthError(401, "Entre na sua conta.");
  const [data, mac] = token.split(".");
  if (!data || !mac) throw new AuthError(401, "Entre na sua conta.");
  const expected = Buffer.from(sign(data));
  const received = Buffer.from(mac);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new AuthError(401, "Entre na sua conta.");
  let session;
  try {
    session = b64urlJson(data);
  } catch {
    throw new AuthError(401, "Entre na sua conta.");
  }
  if (!session.uid || session.exp < Math.floor(now / 1000)) throw new AuthError(401, "Sua sessão expirou. Entre de novo.");
  return session.uid;
}
