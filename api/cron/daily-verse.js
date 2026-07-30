import { neon } from "@neondatabase/serverless";
import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
  // ── Autenticação ────────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // ── Data de hoje (YYYY-MM-DD) ───────────────────────────────────────────
    const today = new Date().toISOString().split("T")[0];

    // ── Idempotência: já existe registro para hoje? ─────────────────────────
    const existing = await sql.query(
      "SELECT id FROM daily_verses WHERE date = $1 LIMIT 1",
      [today]
    );

    if (existing.length > 0) {
      return res.status(200).json({
        success: true,
        message: "Versículo do dia já foi gerado para hoje.",
        date: today,
      });
    }

    // ── Buscar o último verse_id inserido ────────────────────────────────────
    const lastRow = await sql.query(
      "SELECT COALESCE(MAX(verse_id), 0) AS last_id FROM daily_verses"
    );
    const lastVerseId = lastRow[0].last_id;
    const nextVerseId = lastVerseId + 1;

    // ── Buscar os dados do versículo ────────────────────────────────────────
    const verseRows = await sql.query(
      "SELECT * FROM verses WHERE id = $1 LIMIT 1",
      [nextVerseId]
    );

    if (verseRows.length === 0) {
      return res.status(404).json({
        error: `Versículo com id ${nextVerseId} não encontrado na tabela verses.`,
      });
    }

    const verse = verseRows[0];
    const reference = `${verse.book_name} ${verse.chapter}:${verse.verse}`;

    // ── Gerar reflexão com Gemini ───────────────────────────────────────────
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `Forneça uma breve explicação/contexto teológico e uma aplicação prática para o versículo ${reference} - "${verse.text}". Responda em no máximo 2 parágrafos simples e inspiradores.`;

    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: prompt,
    });

    const reflection = response.text;

    // ── Inserir na daily_verses ─────────────────────────────────────────────
    await sql.query(
      "INSERT INTO daily_verses (verse_id, date, reflection) VALUES ($1, $2, $3)",
      [nextVerseId, today, reflection]
    );

    return res.status(200).json({
      success: true,
      date: today,
      reference,
      verse_id: nextVerseId,
      reflection,
    });
  } catch (err) {
    console.error("Erro no cron daily-verse:", err);
    return res.status(500).json({ error: "Erro interno ao gerar o versículo do dia." });
  }
}
