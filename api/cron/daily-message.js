import { timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { todayInBrazil } from "../../src/lib/dates.js";
import { composeDailyMessage, sendBatch } from "../../src/lib/messages.js";

// Cron diário (vercel.json): manda a Palavra do dia por e-mail para quem aceitou na Jornada.
// Roda depois do cron das leituras, então a leitura do dia já existe.
const MAX_PER_RUN = 500;

function isAuthorizedCron(authHeader) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authHeader);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET) {
    console.error("CRON_SECRET não está definida; cron bloqueado.");
    return res.status(500).json({ error: "Cron não configurado." });
  }
  if (!isAuthorizedCron(req.headers.authorization)) return res.status(401).json({ error: "Não autorizado." });

  if (!process.env.RESEND_API_KEY || !process.env.MESSAGES_FROM) {
    return res.status(200).json({ success: true, skipped: "Envio desligado: faltam RESEND_API_KEY e MESSAGES_FROM." });
  }

  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não está definida.");
    const sql = neon(process.env.DATABASE_URL);
    const today = todayInBrazil();

    // A primeira leitura do dia (a mesma que abre a "leitura do dia" no site).
    const [reading] = await sql`
      SELECT category_title AS categoria, reference AS referencia, text AS texto
      FROM daily_readings WHERE date = ${today}::date ORDER BY id ASC LIMIT 1`;
    if (!reading) return res.status(200).json({ success: true, date: today, skipped: "Ainda não há leitura para hoje." });

    const users = await sql`
      SELECT u.id, u.email, u.name FROM app_users u
      WHERE u.wants_messages
        AND NOT EXISTS (SELECT 1 FROM message_log l WHERE l.user_id = u.id AND l.sent_on = ${today}::date)
      ORDER BY u.id LIMIT ${MAX_PER_RUN}`;

    const messages = users.map((u) => ({ userId: u.id, email: u.email, ...composeDailyMessage({ name: u.name, reading, date: today }) }));
    const { sent } = await sendBatch(messages);

    if (sent.length) {
      await sql`INSERT INTO message_log (user_id, sent_on) SELECT unnest(${sent}::bigint[]), ${today}::date ON CONFLICT DO NOTHING`;
    }
    return res.status(200).json({ success: true, date: today, recipients: users.length, sent: sent.length });
  } catch (err) {
    console.error("Erro no cron daily-message:", err);
    return res.status(500).json({ error: "Erro interno ao enviar as mensagens." });
  }
}
