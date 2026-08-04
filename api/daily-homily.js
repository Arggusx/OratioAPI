import { getDailyHomily } from "../src/services/dailyHomily.js";

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
    const homily = await getDailyHomily();
    return res.status(200).json(homily);
  } catch (err) {
    console.error("Erro na homilia diária:", err);
    return res.status(500).json({
      success: false,
      error: "Erro ao buscar a homilia diária.",
    });
  }
}
