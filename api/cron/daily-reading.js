import { neon } from "@neondatabase/serverless";
import { GoogleGenAI } from "@google/genai";
import { CATEGORIES } from "../../src/lib/categories.js";

const MAX_VERSES_PER_READING = 10;
const MIN_VERSES_PER_READING = 5;
const TARGET_TEXT_LENGTH = 1_600;

async function generateReflection(ai, reading) {
  const prompt = `Forneça uma interpretação breve, objetiva e contextual para a leitura bíblica abaixo. Responda em português com exatamente 2 a 4 frases curtas. Não invente versículos nem informações que não estejam no trecho.\n\nCategoria: ${reading.categoryTitle}\nReferência: ${reading.reference}\n\nTrecho:\n${reading.text}`;

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
  let ai;
  const getAi = () => {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY não está definida.");
    }

    ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    return ai;
  };

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
        const reflection = await generateReflection(getAi(), {
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
      LIMIT ${MAX_VERSES_PER_READING}
    `;
    let params = [lastEndId, ...category.books];

    let verseRows = await sql.query(query, params);

    if (verseRows.length === 0) {
      let resetQuery = `
        SELECT id, book_name, chapter, verse, text
        FROM verses
        WHERE book_name IN (${category.books.map((_, i) => `$${i + 1}`).join(", ")})
        ORDER BY id ASC
        LIMIT ${MAX_VERSES_PER_READING}
      `;
      verseRows = await sql.query(resetQuery, category.books);
    }

    if (verseRows.length === 0) continue;

    // Cada bloco contém de 5 a 10 versículos. Trechos mais longos ficam
    // menores para manter o tempo total diário em torno de 5 a 10 minutos.
    let accumulatedLength = 0;
    const selectedVerses = [];
    for (const verseRow of verseRows) {
      selectedVerses.push(verseRow);
      accumulatedLength += verseRow.text.length;

      if (
        selectedVerses.length >= MIN_VERSES_PER_READING &&
        accumulatedLength >= TARGET_TEXT_LENGTH
      ) {
        break;
      }
    }

    const startVerseId = selectedVerses[0].id;
    const endVerseId = selectedVerses[selectedVerses.length - 1].id;

    const first = selectedVerses[0];
    const last = selectedVerses[selectedVerses.length - 1];

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

    const text = selectedVerses.map((v) => `${v.verse}. ${v.text}`).join("\n");

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
      const reflection = await generateReflection(getAi(), {
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

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL não está definida.");
    }

    const sql = neon(process.env.DATABASE_URL);
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
