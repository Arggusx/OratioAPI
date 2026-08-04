import express from "express";
import dailyReadingHandler from "../../api/daily-reading.js";
import { getDailyHomily } from "../services/dailyHomily.js";

const router = express.Router();

router.get("/daily-reading", dailyReadingHandler);

router.get("/daily-homily", async (req, res) => {
  try {
    const homily = await getDailyHomily();
    return res.json(homily);
  } catch (err) {
    console.error("Erro na homilia diária:", err);
    return res.status(500).json({
      success: false,
      error: "Erro ao buscar a homilia diária.",
    });
  }
});

export default router;
