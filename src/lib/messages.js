// Mensagem diária por e-mail para quem aceitou recebê-la na Jornada: a Palavra do dia e o link para rezar.
// Sem RESEND_API_KEY nada é enviado (o cron só informa que está desligado).

const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const BATCH_SIZE = 100; // limite do envio em lote do Resend

export const siteUrl = () => (process.env.MESSAGES_SITE_URL || "https://www.oratiodaily.com").replace(/\/+$/, "");

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function excerpt(text, max = 320) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

function formatDate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d))
  );
}

/** Monta o e-mail de uma pessoa a partir da leitura do dia. */
export function composeDailyMessage({ name, reading, date }) {
  const url = siteUrl();
  const greeting = name ? `Bom dia, ${name}!` : "Bom dia!";
  const when = formatDate(date);
  const subject = `A Palavra de hoje · ${reading.referencia}`;
  const passage = excerpt(reading.texto);
  const optOut = `${url}/jornada`;

  const text = [
    greeting,
    "",
    `A leitura para ${when} é ${reading.referencia} (${reading.categoria}):`,
    "",
    `“${passage}”`,
    "",
    `Leia inteira e reze com calma: ${url}/`,
    "",
    `Você recebe esta mensagem porque pediu na sua Jornada do Oratio. Para não receber mais, desligue em ${optOut}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#FDFBF7;font-family:Inter,Segoe UI,Arial,sans-serif;color:#332A25">
<div style="max-width:560px;margin:0 auto;padding:28px 20px">
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:.15em;text-transform:uppercase;font-weight:700;color:#B84A13">Oratio Daily</p>
  <h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:26px;font-weight:600;color:#2D241F">${escapeHtml(greeting)}</h1>
  <p style="margin:0 0 14px;line-height:1.6">A leitura para ${escapeHtml(when)} é <strong>${escapeHtml(reading.referencia)}</strong> (${escapeHtml(reading.categoria)}):</p>
  <blockquote style="margin:0 0 20px;padding:14px 18px;border-left:4px solid #C8963E;background:#FFFDF9;border-radius:8px;font-family:Georgia,serif;font-size:18px;line-height:1.55">${escapeHtml(passage)}</blockquote>
  <p style="margin:0 0 28px"><a href="${url}/" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#B84A13;color:#FFFAF4;font-weight:700;text-decoration:none">Ler e rezar no Oratio</a></p>
  <p style="margin:0;font-size:12px;line-height:1.5;color:#705E52">Você recebe esta mensagem porque pediu na sua Jornada do Oratio. <a href="${optOut}" style="color:#705E52">Para não receber mais, desligue aqui</a>.</p>
</div></body></html>`;

  return { subject, text, html, optOut };
}

/** Envia em lotes de até 100 pelo Resend. Devolve os ids de quem recebeu. */
export async function sendBatch(messages, { apiKey = process.env.RESEND_API_KEY, from = process.env.MESSAGES_FROM, fetchImpl = fetch } = {}) {
  if (!apiKey || !from) return { skipped: true, sent: [] };
  const sent = [];
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const res = await fetchImpl(RESEND_BATCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(
        batch.map((m) => ({
          from,
          to: [m.email],
          subject: m.subject,
          html: m.html,
          text: m.text,
          headers: { "List-Unsubscribe": `<${m.optOut}>` },
        }))
      ),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error("Resend recusou o lote:", res.status, (await res.text()).slice(0, 300));
      break; // não marca como enviado; o próximo cron tenta de novo no dia seguinte
    }
    sent.push(...batch.map((m) => m.userId));
  }
  return { skipped: false, sent };
}
