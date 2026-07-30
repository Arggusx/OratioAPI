import { neon } from "@neondatabase/serverless";
import { GoogleGenAI } from "@google/genai";

export async function generateDailyVerseForDate(sql, today) {
  const existing = await sql.query(
    "SELECT id FROM daily_verses WHERE date::text = $1 LIMIT 1",
    [today]
  );

  if (existing.length > 0) {
    return existing[0];
  }

  const lastRow = await sql.query(
    "SELECT COALESCE(MAX(verse_id), 0) AS last_id FROM daily_verses"
  );
  const lastVerseId = lastRow[0].last_id;
  const nextVerseId = lastVerseId + 1;

  const verseRows = await sql.query(
    "SELECT * FROM verses WHERE id = $1 LIMIT 1",
    [nextVerseId]
  );

  if (verseRows.length === 0) {
    throw new Error(`Versículo com id ${nextVerseId} não encontrado.`);
  }

  const verse = verseRows[0];
  const reference = `${verse.book_name} ${verse.chapter}:${verse.verse}`;

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = `Forneça uma breve explicação/contexto teológico e uma aplicação prática para o versículo ${reference} - "${verse.text}". Responda em no máximo 2 parágrafos simples e inspiradores.`;

  const response = await ai.models.generateContent({
    model: "gemini-flash-latest",
    contents: prompt,
  });

  const reflection = response.text;

  await sql.query(
    "INSERT INTO daily_verses (verse_id, date, reflection) VALUES ($1, $2, $3)",
    [nextVerseId, today, reflection]
  );

  return {
    verse_id: nextVerseId,
    date: today,
    reference,
    reflection,
  };
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    const today = new Date().toISOString().split("T")[0];

    const existing = await sql.query(
      "SELECT id FROM daily_verses WHERE date::text = $1 LIMIT 1",
      [today]
    );

    if (existing.length > 0) {
      return res.status(200).json({
        success: true,
        message: "Versículo do dia já foi gerado para hoje.",
        date: today,
      });
    }

    const result = await generateDailyVerseForDate(sql, today);

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("Erro no cron daily-verse:", err);
    return res.status(500).json({ error: "Erro interno ao gerar o versículo do dia." });
  }
}
