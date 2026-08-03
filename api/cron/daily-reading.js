import { neon } from "@neondatabase/serverless";
import { CATEGORIES } from "../../src/lib/categories.js";

const CHUNK_SIZE = 12;

async function generateReflection(ai, reading) {
  const prompt = `Forneça uma breve interpretação teológica e uma aplicação prática para a leitura bíblica abaixo. Responda em português, em no máximo 2 parágrafos simples e inspiradores. Não invente versículos nem informações que não estejam no trecho.\n\nCategoria: ${reading.categoryTitle}\nReferência: ${reading.reference}\n\nTrecho:\n${reading.text}`;

  const response = await ai.models.generateContent({
    model: "gemini-flash-latest",
    contents: prompt,
  });

  if (!response.text) {
    throw new Error(`A IA não retornou uma interpretação para ${reading.reference}.`);
  }

  return response.text;
}

export async function generateDailyReadingsForDate(sql, today) {
  const generatedReadings = [];
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  for (const key of Object.keys(CATEGORIES)) {
    const category = CATEGORIES[key];

    const existing = await sql.query(
      `SELECT id, category_title, reference, text, reflection
       FROM daily_readings
       WHERE date::text = $1 AND category = $2
       LIMIT 1`,
      [today, category.id]
    );

    // Leituras já criadas antes desta mudança podem não ter interpretação.
    // Nesse caso, completa somente a chamada de IA que estiver faltando.
    if (existing.length > 0) {
      const reading = existing[0];

      if (!reading.reflection) {
        const reflection = await generateReflection(ai, {
          categoryTitle: reading.category_title,
          reference: reading.reference,
          text: reading.text,
        });

        await sql.query(
          "UPDATE daily_readings SET reflection = $1 WHERE id = $2",
          [reflection, reading.id]
        );
      }

      continue;
    }

    const lastRow = await sql.query(
      "SELECT COALESCE(MAX(end_verse_id), 0) AS last_end_id FROM daily_readings WHERE category = $1",
      [category.id]
    );
    const lastEndId = lastRow[0].last_end_id;

    const bookPlaceholders = category.books.map((_, i) => `$${i + 2}`).join(", ");
    let query = `
      SELECT id, book_name, chapter, verse, text
      FROM verses
      WHERE id > $1 AND book_name IN (${bookPlaceholders})
      ORDER BY id ASC
      LIMIT ${CHUNK_SIZE}
    `;
    let params = [lastEndId, ...category.books];

    let verseRows = await sql.query(query, params);

    if (verseRows.length === 0) {
      let resetQuery = `
        SELECT id, book_name, chapter, verse, text
        FROM verses
        WHERE book_name IN (${category.books.map((_, i) => `$${i + 1}`).join(", ")})
        ORDER BY id ASC
        LIMIT ${CHUNK_SIZE}
      `;
      verseRows = await sql.query(resetQuery, category.books);
    }

    if (verseRows.length === 0) continue;

    const startVerseId = verseRows[0].id;
    const endVerseId = verseRows[verseRows.length - 1].id;

    const first = verseRows[0];
    const last = verseRows[verseRows.length - 1];

    let reference = "";
    if (first.book_name === last.book_name) {
      if (first.chapter === last.chapter) {
        reference = `${first.book_name} ${first.chapter}:${first.verse}-${last.verse}`;
      } else {
        reference = `${first.book_name} ${first.chapter}:${first.verse} - ${last.chapter}:${last.verse}`;
      }
    } else {
      reference = `${first.book_name} ${first.chapter}:${first.verse} - ${last.book_name} ${last.chapter}:${last.verse}`;
    }

    const text = verseRows.map((v) => `${v.verse}. ${v.text}`).join("\n");

    const insertedRows = await sql.query(
      `INSERT INTO daily_readings 
         (date, category, category_title, start_verse_id, end_verse_id, reference, text, estimated_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (date, category) DO NOTHING
       RETURNING id`,
      [
        today,
        category.id,
        category.title,
        startVerseId,
        endVerseId,
        reference,
        text,
        category.estimated_time,
      ]
    );

    // Há uma chamada ao Gemini para cada uma das três categorias diárias.
    // Persistimos antes da chamada para que uma falha possa ser retomada sem
    // avançar o ponteiro de leitura.
    const readingId = insertedRows[0]?.id;
    if (readingId) {
      const reflection = await generateReflection(ai, {
        categoryTitle: category.title,
        reference,
        text,
      });

      await sql.query(
        "UPDATE daily_readings SET reflection = $1 WHERE id = $2",
        [reflection, readingId]
      );
    }

    generatedReadings.push({
      category: category.id,
      reference,
    });
  }

  return generatedReadings;
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    const today = new Date().toISOString().split("T")[0];
    const generated = await generateDailyReadingsForDate(sql, today);

    return res.status(200).json({
      success: true,
      date: today,
      generated,
    });
  } catch (err) {
    console.error("Erro no cron daily-reading:", err);
    return res.status(500).json({ error: "Erro interno ao gerar leitura diária." });
  }
}
