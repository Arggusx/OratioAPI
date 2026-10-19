import { neon } from "@neondatabase/serverless";
import { generateDailyReadingsForDate } from "./cron/daily-reading.js";
import { CATEGORIES } from "../src/lib/categories.js";
import { isIsoDate, todayInBrazil } from "../src/lib/dates.js";

// Tempo máximo que a requisição espera pelo Gemini antes de responder só com
// os textos. A interpretação que faltar é completada numa próxima chamada.
const REFLECTION_TIMEOUT_MS = 7_000;

const READING_COLUMNS = `
    date::text AS data,
    category AS id,
    category_title AS categoria,
    reference AS referencia,
    estimated_time AS tempo_estimado,
    text AS texto,
    NULLIF(reflection, '') AS interpretacao`;

const CATEGORY_ORDER = Object.keys(CATEGORIES);

function sortByCategory(readings) {
  return [...readings].sort((a, b) => CATEGORY_ORDER.indexOf(a.id) - CATEGORY_ORDER.indexOf(b.id));
}

async function getReadingsForDate(sql, date) {
  const rows = await sql.query(
    `SELECT ${READING_COLUMNS} FROM daily_readings
     WHERE date::text = $1 AND category = ANY($2)`,
    [date, CATEGORY_ORDER]
  );
  return sortByCategory(rows);
}

// "seq" é o N-ésimo bloco de cada categoria desde o início da Bíblia (1 = Gênesis 1,
// Jó 1, Romanos 1). Permite que um leitor recomece a sequência por conta própria
// reaproveitando os textos e interpretações já gravados.
async function getReadingsForSequence(sql, seq) {
  const rows = await Promise.all(
    CATEGORY_ORDER.map(async (category) => {
      const [row] = await sql.query(
        `SELECT ${READING_COLUMNS} FROM daily_readings
         WHERE category = $1
         ORDER BY date ASC, id ASC
         OFFSET $2 LIMIT 1`,
        [category, seq - 1]
      );
      return row;
    })
  );
  return rows.filter(Boolean);
}

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

  const today = todayInBrazil();
  const { date: dateParam, seq: seqParam } = req.query ?? {};

  if (seqParam !== undefined && !/^[1-9]\d{0,5}$/.test(String(seqParam))) {
    return res.status(400).json({ error: "Parâmetro 'seq' deve ser um inteiro positivo." });
  }
  if (dateParam !== undefined && !isIsoDate(String(dateParam))) {
    return res.status(400).json({ error: "Parâmetro 'date' deve estar no formato AAAA-MM-DD." });
  }
  if (dateParam !== undefined && String(dateParam) > today) {
    return res.status(400).json({ error: "Não é possível consultar leituras de dias futuros." });
  }

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL não está definida.");
    }

    const sql = neon(process.env.DATABASE_URL);

    if (seqParam !== undefined) {
      const readings = await getReadingsForSequence(sql, Number(seqParam));
      if (readings.length === 0) {
        return res.status(404).json({ error: "Leitura não encontrada para esta sequência." });
      }
      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
      return res.status(200).json({ seq: Number(seqParam), readings });
    }

    const date = dateParam ? String(dateParam) : today;
    let readings = await getReadingsForDate(sql, date);

    const isComplete =
      readings.length === CATEGORY_ORDER.length && readings.every((r) => r.interpretacao);

    // Só o dia atual é gerado sob demanda; dias passados são apenas consultados.
    if (date === today && !isComplete) {
      await generateDailyReadingsForDate(sql, today, { reflectionTimeoutMs: REFLECTION_TIMEOUT_MS });
      readings = await getReadingsForDate(sql, today);
    }

    if (readings.length === 0) {
      return res.status(404).json({ error: "Nenhuma leitura registrada para esta data." });
    }

    const complete =
      readings.length === CATEGORY_ORDER.length && readings.every((r) => r.interpretacao);
    res.setHeader(
      "Cache-Control",
      complete ? "public, s-maxage=600, stale-while-revalidate=3600" : "no-store"
    );

    return res.status(200).json({ date, readings });
  } catch (err) {
    console.error("Erro ao buscar leitura diária:", err);
    return res.status(500).json({ error: "Erro interno ao buscar a leitura diária." });
  }
}
