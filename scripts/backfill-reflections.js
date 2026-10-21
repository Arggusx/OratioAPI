/**
 * Gera as interpretações que ficaram faltando em leituras já gravadas.
 *
 * Uso:
 *   npm run backfill -- --dry-run          lista o que falta, sem chamar a IA
 *   npm run backfill                       gera tudo o que falta
 *   npm run backfill -- --limit=10         gera no máximo 10
 *   npm run backfill -- --category=poesia_sabedoria
 *   npm run backfill -- --delay=8000       espera 8 s entre chamadas (padrão: 5 s)
 *
 * As leituras mais antigas são processadas primeiro, porque são as que aparecem
 * para quem usa "Recomeçar a leitura" no site. O script pode ser interrompido
 * e executado de novo: ele só processa o que ainda estiver sem interpretação.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { GoogleGenAI } from "@google/genai";
import { generateReflection } from "../api/cron/daily-reading.js";
import { CATEGORIES } from "../src/lib/categories.js";

const MAX_RETRIES = 3;
// Para depois de várias falhas seguidas: geralmente é a cota diária do Gemini.
const MAX_CONSECUTIVE_FAILURES = 3;

function parseArgs(argv) {
  const options = { dryRun: false, limit: null, delay: 5_000, category: null };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.split("=")[1]);
    else if (arg.startsWith("--delay=")) options.delay = Number(arg.split("=")[1]);
    else if (arg.startsWith("--category=")) options.category = arg.split("=")[1];
    else {
      console.error(`❌ Opção desconhecida: ${arg}`);
      process.exit(1);
    }
  }
  if (options.limit !== null && !(options.limit > 0)) {
    console.error("❌ --limit precisa ser um número maior que zero.");
    process.exit(1);
  }
  if (!(options.delay >= 0)) {
    console.error("❌ --delay precisa ser um número de milissegundos.");
    process.exit(1);
  }
  if (options.category && !CATEGORIES[options.category]) {
    console.error(`❌ Categoria inválida. Use uma destas: ${Object.keys(CATEGORIES).join(", ")}`);
    process.exit(1);
  }
  return options;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Erros temporários (limite de requisições, serviço sobrecarregado) valem nova tentativa.
function isRetryable(err) {
  const text = `${err?.status ?? ""} ${err?.message ?? ""}`;
  return /429|500|503|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|rate/i.test(text);
}

async function generateWithRetry(ai, reading, baseDelay) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await generateReflection(ai, reading);
    } catch (err) {
      if (attempt >= MAX_RETRIES || !isRetryable(err)) throw err;
      const wait = Math.max(baseDelay, 5_000) * 2 ** attempt;
      console.warn(`   ⏳ ${err.message?.slice(0, 80)} — tentando de novo em ${wait / 1000} s`);
      await sleep(wait);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL não encontrada. Crie um arquivo .env com a variável.");
    process.exit(1);
  }
  if (!options.dryRun && !process.env.GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY não encontrada. Crie um arquivo .env com a variável.");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const categories = options.category ? [options.category] : Object.keys(CATEGORIES);

  const pending = await sql.query(
    `SELECT id, date::text AS date, category, category_title, reference, text
     FROM daily_readings
     WHERE (reflection IS NULL OR reflection = '') AND category = ANY($1)
     ORDER BY date ASC, id ASC
     ${options.limit ? `LIMIT ${options.limit}` : ""}`,
    [categories]
  );

  if (pending.length === 0) {
    console.log("✅ Nenhuma leitura sem interpretação. Nada a fazer.");
    return;
  }

  console.log(`📖 ${pending.length} leitura(s) sem interpretação.\n`);

  if (options.dryRun) {
    for (const r of pending) console.log(`   ${r.date}  ${r.category.padEnd(18)} ${r.reference}`);
    console.log("\n(--dry-run: nenhuma interpretação foi gerada)");
    return;
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  let done = 0;
  let failed = 0;
  let consecutiveFailures = 0;

  for (const [index, reading] of pending.entries()) {
    const label = `[${index + 1}/${pending.length}] ${reading.date} ${reading.reference}`;
    try {
      const reflection = await generateWithRetry(
        ai,
        { categoryTitle: reading.category_title, reference: reading.reference, text: reading.text },
        options.delay
      );
      // A condição evita sobrescrever uma interpretação gravada nesse meio-tempo pela API.
      await sql.query(
        "UPDATE daily_readings SET reflection = $1 WHERE id = $2 AND (reflection IS NULL OR reflection = '')",
        [reflection, reading.id]
      );
      done++;
      consecutiveFailures = 0;
      console.log(`✅ ${label}`);
    } catch (err) {
      failed++;
      consecutiveFailures++;
      console.error(`❌ ${label} — ${err.message?.slice(0, 120)}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`\n⛔ ${MAX_CONSECUTIVE_FAILURES} falhas seguidas (provavelmente a cota do Gemini). Parando.`);
        break;
      }
    }

    if (index < pending.length - 1) await sleep(options.delay);
  }

  const remaining = pending.length - done;
  console.log(`\nResumo: ${done} gerada(s), ${failed} falha(s), ${remaining} ainda pendente(s).`);
  if (remaining > 0) console.log("Rode o script de novo mais tarde para continuar de onde parou.");
}

main().catch((err) => {
  console.error("❌ Erro inesperado:", err);
  process.exit(1);
});
