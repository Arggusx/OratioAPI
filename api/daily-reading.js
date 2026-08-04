import { neon } from "@neondatabase/serverless";
import { generateDailyReadingsForDate } from "./cron/daily-reading.js";
import { CATEGORIES } from "../src/lib/categories.js";

const DAILY_READINGS_QUERY = `
  SELECT
    category AS id,
    category_title AS categoria,
    reference AS referencia,
    estimated_time AS tempo_estimado,
    text AS texto,
    reflection AS interpretacao
  FROM daily_readings
  WHERE date::text = $1
  ORDER BY
    CASE category
      WHEN 'antigo_testamento' THEN 1
      WHEN 'poesia_sabedoria' THEN 2
      WHEN 'cartas_epistolas' THEN 3
      ELSE 4
    END`;

async function getReadingsForDate(sql, date) {
  return sql.query(DAILY_READINGS_QUERY, [date]);
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

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL não está definida.");
    }

    const sql = neon(process.env.DATABASE_URL);
    const today = new Date().toISOString().split("T")[0];
    let readings = await getReadingsForDate(sql, today);

    const hasCompleteDailyReading =
      readings.length === Object.keys(CATEGORIES).length &&
      readings.every((reading) => reading.interpretacao);

    if (!hasCompleteDailyReading) {
      await generateDailyReadingsForDate(sql, today);
      readings = await getReadingsForDate(sql, today);
    }

    const hasAllReadingsWithInterpretation =
      readings.length === Object.keys(CATEGORIES).length &&
      readings.every((reading) => reading.interpretacao);

    if (!hasAllReadingsWithInterpretation) {
      throw new Error("Não foi possível gerar os três blocos de leitura diária.");
    }

    return res.status(200).json({ readings });
  } catch (err) {
    console.error("Erro ao buscar leitura diária:", err);
    return res.status(500).json({ error: "Erro interno ao buscar a leitura diária." });
  }
}
