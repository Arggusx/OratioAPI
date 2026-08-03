import { neon } from "@neondatabase/serverless";
import { generateDailyReadingsForDate } from "./cron/daily-reading.js";

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
         date::text AS date,
         category AS id,
         category_title AS titulo_categoria,
         reference AS referencia,
         estimated_time AS tempo_estimado,
         text AS texto,
         reflection AS reflexao
       FROM daily_readings
       WHERE date::text = $1
       ORDER BY 
         CASE category
           WHEN 'at_historia' THEN 1
           WHEN 'poesia_sabedoria' THEN 2
           WHEN 'cartas_epistolas' THEN 3
           ELSE 4
         END`,
      [today]
    );

    if (rows.length < 3 || rows.some((row) => !row.reflexao)) {
      await generateDailyReadingsForDate(sql, today);

      rows = await sql.query(
        `SELECT
           date::text AS date,
           category AS id,
           category_title AS titulo_categoria,
           reference AS referencia,
           estimated_time AS tempo_estimado,
           text AS texto,
           reflection AS reflexao
         FROM daily_readings
         WHERE date::text = $1
         ORDER BY 
           CASE category
             WHEN 'at_historia' THEN 1
             WHEN 'poesia_sabedoria' THEN 2
             WHEN 'cartas_epistolas' THEN 3
             ELSE 4
           END`,
        [today]
      );
    }

    if (rows.length === 0) {
      const latestDateRow = await sql.query(
        "SELECT MAX(date::text) AS latest_date FROM daily_readings"
      );
      const latestDate = latestDateRow[0]?.latest_date;

      if (latestDate) {
        rows = await sql.query(
          `SELECT
             date::text AS date,
             category AS id,
             category_title AS titulo_categoria,
             reference AS referencia,
             estimated_time AS tempo_estimado,
             text AS texto,
             reflection AS reflexao
           FROM daily_readings
           WHERE date::text = $1
           ORDER BY 
             CASE category
               WHEN 'at_historia' THEN 1
               WHEN 'poesia_sabedoria' THEN 2
               WHEN 'cartas_epistolas' THEN 3
               ELSE 4
             END`,
          [latestDate]
        );
      }
    }

    if (rows.length === 0) {
      return res.status(404).json({
        error: "Nenhuma leitura diária encontrada.",
      });
    }

    const formattedDate = rows[0].date.split("T")[0];

    const readings = rows.map((r) => ({
      id: r.id,
      titulo_categoria: r.titulo_categoria,
      referencia: r.referencia,
      tempo_estimado: r.tempo_estimado,
      texto: r.texto,
      reflexao: r.reflexao,
    }));

    return res.status(200).json({
      date: formattedDate,
      total_estimated_time: "~6 a 8 min",
      readings,
    });
  } catch (err) {
    console.error("Erro ao buscar leitura diária:", err);
    return res.status(500).json({ error: "Erro interno ao buscar a leitura diária." });
  }
}
