import { getDailyReflection } from "../src/services/dailyDiscovery.js";

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
    const reflection = await getDailyReflection();
    return res.status(200).json(reflection);
  } catch (err) {
    console.error("Erro na Homilia Diária:", err);
    return res.status(500).json({
      success: false,
      error: "Erro ao buscar a homilia diária.",
    });
  }
}
