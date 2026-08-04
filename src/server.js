import "dotenv/config";
import express from "express";
import cors from "cors";
import dailyPrayerRoutes from "./routes/dailyPrayer.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api", dailyPrayerRoutes);
app.get("/", (req, res) => {
    res.send("A API do menino Douglinhas está rodando com toda força!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`API rodando na porta ${PORT}`);
});
