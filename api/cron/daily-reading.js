import { neon } from "@neondatabase/serverless";
import { GoogleGenAI } from "@google/genai";
import { CATEGORIES } from "../../src/lib/categories.js";
import { todayInBrazil } from "../../src/lib/dates.js";

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

function withTimeout(promise, ms) {
  if (!ms) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo esgotado (${ms} ms).`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function buildReference(first, last) {
  if (first.book_name !== last.book_name) {
    return `${first.book_name} ${first.chapter}:${first.verse} - ${last.book_name} ${last.chapter}:${last.verse}`;
  }
  if (first.chapter !== last.chapter) {
    return `${first.book_name} ${first.chapter}:${first.verse} - ${last.chapter}:${last.verse}`;
  }
  return `${first.book_name} ${first.chapter}:${first.verse}-${last.verse}`;
}

async function selectNextVerses(sql, category) {
  const lastRow = await sql.query(
    "SELECT COALESCE(MAX(end_verse_id), 0) AS last_end_id FROM daily_readings WHERE category = $1",
    [category.id]
  );
  const lastEndId = lastRow[0].last_end_id;

  const bookPlaceholders = category.books.map((_, i) => `$${i + 2}`).join(", ");
  let verseRows = await sql.query(
    `SELECT id, book_name, chapter, verse, text
     FROM verses
     WHERE id > $1 AND book_name IN (${bookPlaceholders})
     ORDER BY id ASC
     LIMIT ${MAX_VERSES_PER_READING}`,
    [lastEndId, ...category.books]
  );

  // Fim da categoria: recomeça do primeiro livro.
  if (verseRows.length === 0) {
    verseRows = await sql.query(
      `SELECT id, book_name, chapter, verse, text
       FROM verses
       WHERE book_name IN (${category.books.map((_, i) => `$${i + 1}`).join(", ")})
       ORDER BY id ASC
       LIMIT ${MAX_VERSES_PER_READING}`,
      category.books
    );
  }

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

  return selectedVerses;
}

/**
 * Garante os três blocos do dia em duas fases:
 *   1. grava o texto de todas as categorias (sem depender da IA);
 *   2. tenta gerar as interpretações que faltam, em paralelo.
 * Uma falha do Gemini nunca impede os textos de serem gravados nem as outras
 * categorias de receberem interpretação; a próxima chamada completa o que faltar.
 */
export async function generateDailyReadingsForDate(sql, today, { reflectionTimeoutMs } = {}) {
  const generatedReadings = [];

  for (const category of Object.values(CATEGORIES)) {
    const existing = await sql.query(
      "SELECT id FROM daily_readings WHERE date::text = $1 AND category = $2 LIMIT 1",
      [today, category.id]
    );
    if (existing.length > 0) continue;

    const selectedVerses = await selectNextVerses(sql, category);
    if (selectedVerses.length === 0) continue;

    const first = selectedVerses[0];
    const last = selectedVerses[selectedVerses.length - 1];
    const reference = buildReference(first, last);
    const text = selectedVerses.map((v) => `${v.verse}. ${v.text}`).join("\n");

    const inserted = await sql.query(
      `INSERT INTO daily_readings
         (date, category, category_title, start_verse_id, end_verse_id, reference, text, estimated_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (date, category) DO NOTHING
       RETURNING id`,
      [today, category.id, category.title, first.id, last.id, reference, text, category.estimated_time]
    );

    if (inserted.length > 0) {
      generatedReadings.push({ category: category.id, reference });
    }
  }

  const missingReflections = await sql.query(
    `SELECT id, category_title, reference, text
     FROM daily_readings
     WHERE date::text = $1 AND (reflection IS NULL OR reflection = '')`,
    [today]
  );

  if (missingReflections.length > 0) {
    if (!process.env.GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY não está definida; leituras salvas sem interpretação.");
    } else {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const results = await Promise.allSettled(
        missingReflections.map(async (reading) => {
          const reflection = await withTimeout(
            generateReflection(ai, {
              categoryTitle: reading.category_title,
              reference: reading.reference,
              text: reading.text,
            }),
            reflectionTimeoutMs
          );
          await sql.query("UPDATE daily_readings SET reflection = $1 WHERE id = $2", [
            reflection,
            reading.id,
          ]);
        })
      );

      results
        .filter((result) => result.status === "rejected")
        .forEach((result) => console.error("Falha ao gerar interpretação:", result.reason));
    }
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
    const today = todayInBrazil();
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
