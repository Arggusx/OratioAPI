import { CommunityError } from "./community.js";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Confere na Cloudflare o token do Turnstile que o site mandou junto com o envio.
 * Sem TURNSTILE_SECRET_KEY a verificação fica desligada (útil até as chaves estarem configuradas);
 * com ela, envio sem token válido é recusado. Se a Cloudflare não responder, também recusamos:
 * é melhor pedir para a pessoa tentar de novo do que abrir a porta para robôs.
 */
export async function verifyTurnstile(token, ip, { fetchImpl = fetch } = {}) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { skipped: true };

  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    throw new CommunityError(403, "Confirme que você não é um robô e tente de novo.");
  }

  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);

  let data;
  try {
    const res = await fetchImpl(VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
    data = await res.json();
  } catch (err) {
    console.error("Turnstile indisponível:", err?.message);
    throw new CommunityError(503, "Não foi possível confirmar o envio agora. Tente de novo em instantes.");
  }

  if (!data?.success) {
    console.warn("Turnstile recusou o token:", data?.["error-codes"]);
    throw new CommunityError(403, "Confirme que você não é um robô e tente de novo.");
  }
  return { skipped: false };
}
