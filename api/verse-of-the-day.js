import { neon } from "@neondatabase/serverless";
import { generateDailyVerseForDate } from "./cron/daily-verse.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    const today = new Date().toISOString().split("T")[0];

    let rows = await sql.query(
      `SELECT
         dv.date::text AS date,
         v.book_name,
         v.chapter,
         v.verse,
         v.text,
         dv.reflection
       FROM daily_verses dv
       JOIN verses v ON v.id = dv.verse_id
       WHERE dv.date::text = $1
       LIMIT 1`,
      [today]
    );

    if (rows.length === 0) {
      await generateDailyVerseForDate(sql, today);

      rows = await sql.query(
        `SELECT
           dv.date::text AS date,
           v.book_name,
           v.chapter,
           v.verse,
           v.text,
           dv.reflection
         FROM daily_verses dv
         JOIN verses v ON v.id = dv.verse_id
         WHERE dv.date::text = $1
         LIMIT 1`,
        [today]
      );
    }

    if (rows.length === 0) {
      rows = await sql.query(
        `SELECT
           dv.date::text AS date,
           v.book_name,
           v.chapter,
           v.verse,
           v.text,
           dv.reflection
         FROM daily_verses dv
         JOIN verses v ON v.id = dv.verse_id
         ORDER BY dv.date DESC, dv.id DESC
         LIMIT 1`
      );
    }

    if (rows.length === 0) {
      return res.status(404).json({
        error: "Nenhum versículo do dia encontrado.",
      });
    }

    const row = rows[0];
    const formattedDate = row.date.split("T")[0];

    return res.status(200).json({
      date: formattedDate,
      reference: `${row.book_name} ${row.chapter}:${row.verse}`,
      book: row.book_name,
      chapter: row.chapter,
      verse: row.verse,
      text: row.text,
      reflection: row.reflection,
    });
  } catch (err) {
    console.error("Erro ao buscar versículo do dia:", err);
    return res.status(500).json({ error: "Erro interno ao buscar o versículo do dia." });
  }
}
