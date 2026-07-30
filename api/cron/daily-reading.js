import { neon } from "@neondatabase/serverless";
import { CATEGORIES } from "../../src/lib/categories.js";

// Quantidade padrão de versículos por bloco (~12 a 15 versículos para ~2 a 3 minutos de leitura)
const CHUNK_SIZE = 12;

export default async function handler(req, res) {
  // ── Autenticação ────────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    const today = new Date().toISOString().split("T")[0];

    // ── Idempotência: verificar se já existem os 3 blocos para hoje ─────────
    const existing = await sql.query(
      "SELECT category FROM daily_readings WHERE date = $1",
      [today]
    );

    if (existing.length >= 3) {
      return res.status(200).json({
        success: true,
        message: "Os 3 blocos de leitura diária já foram gerados para hoje.",
        date: today,
      });
    }

    const generatedReadings = [];

    // ── Processar cada uma das 3 categorias ─────────────────────────────────
    for (const key of Object.keys(CATEGORIES)) {
      const category = CATEGORIES[key];

      // Se o bloco dessa categoria já foi inserido hoje, pula
      const alreadyDone = existing.some((r) => r.category === category.id);
      if (alreadyDone) continue;

      // 1. Buscar o último end_verse_id processado nesta categoria
      const lastRow = await sql.query(
        "SELECT COALESCE(MAX(end_verse_id), 0) AS last_end_id FROM daily_readings WHERE category = $1",
        [category.id]
      );
      const lastEndId = lastRow[0].last_end_id;

      // 2. Buscar o próximo conjunto de versículos pertencentes aos livros desta categoria
      // Se lastEndId > 0, busca a partir de `id > lastEndId`
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

      // Se chegou ao fim dos livros da categoria, reinicia a leitura sequencial do início da categoria
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

      if (verseRows.length === 0) {
        continue;
      }

      const startVerseId = verseRows[0].id;
      const endVerseId = verseRows[verseRows.length - 1].id;

      // 3. Formatar referência (ex: "Gênesis 1:1-12" ou "Gênesis 1:1 - Gênesis 2:4")
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

      // 4. Formatar o texto concatenado dos versículos
      const text = verseRows
        .map((v) => `${v.verse}. ${v.text}`)
        .join("\n");

      // 5. Inserir no banco de dados
      await sql.query(
        `INSERT INTO daily_readings 
           (date, category, category_title, start_verse_id, end_verse_id, reference, text, estimated_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (date, category) DO NOTHING`,
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

      generatedReadings.push({
        category: category.id,
        reference,
      });
    }

    return res.status(200).json({
      success: true,
      date: today,
      generated: generatedReadings,
    });
  } catch (err) {
    console.error("Erro no cron daily-reading:", err);
    return res.status(500).json({ error: "Erro interno ao gerar leitura diária." });
  }
}
