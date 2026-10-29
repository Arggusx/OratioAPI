import { CATEGORIES } from "./categories.js";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function generateReflection(ai, reading) {
  const prompt = `Forneça uma interpretação breve, objetiva e contextual para a leitura bíblica abaixo. Responda em português com exatamente 2 a 4 frases curtas. Não invente versículos nem informações que não estejam no trecho.\n\nCategoria: ${reading.categoryTitle}\nReferência: ${reading.reference}\n\nTrecho:\n${reading.text}`;

  const response = await ai.models.generateContent({
    model: "gemini-flash-latest",
    contents: prompt,
    // Sem a etapa de "raciocínio": para 2 a 4 frases ela só deixa a resposta
    // lenta, e o site espera poucos segundos pela interpretação.
    config: { thinkingConfig: { thinkingBudget: 0 } },
  });

  if (!response.text) {
    throw new Error(`A IA não retornou uma interpretação para ${reading.reference}.`);
  }

  return response.text;
}

// Erros temporários (limite de requisições, serviço sobrecarregado) valem nova tentativa.
export function isRetryable(err) {
  const text = `${err?.status ?? ""} ${err?.message ?? ""}`;
  return /429|500|503|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|rate/i.test(text);
}

export async function generateWithRetry(ai, reading, { retries = 3, baseDelay = 5_000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await generateReflection(ai, reading);
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const wait = Math.max(baseDelay, 5_000) * 2 ** attempt;
      console.warn(`Gemini: ${err.message?.slice(0, 80)} — nova tentativa em ${wait / 1000} s`);
      await sleep(wait);
    }
  }
}

/**
 * Completa, uma por vez, as interpretações que ficaram faltando em dias anteriores
 * (mais antigas primeiro). Para ao atingir o limite, o tempo máximo ou após falhas
 * seguidas (geralmente a cota diária do Gemini); o restante fica para a próxima execução.
 */
export async function backfillReflections(sql, ai, { limit = 10, deadlineMs = 40_000, delay = 2_000 } = {}) {
  const startedAt = Date.now();
  const pending = await sql.query(
    `SELECT id, category_title, reference, text
     FROM daily_readings
     WHERE (reflection IS NULL OR reflection = '') AND category = ANY($1)
     ORDER BY date ASC, id ASC
     LIMIT ${Number(limit)}`,
    [Object.keys(CATEGORIES)]
  );

  let done = 0;
  let consecutiveFailures = 0;
  for (const reading of pending) {
    if (Date.now() - startedAt > deadlineMs) break;
    try {
      const reflection = await generateWithRetry(
        ai,
        { categoryTitle: reading.category_title, reference: reading.reference, text: reading.text },
        { retries: 2 }
      );
      // A condição evita sobrescrever uma interpretação gravada nesse meio-tempo.
      await sql.query(
        "UPDATE daily_readings SET reflection = $1 WHERE id = $2 AND (reflection IS NULL OR reflection = '')",
        [reflection, reading.id]
      );
      done++;
      consecutiveFailures = 0;
    } catch (err) {
      console.error(`Falha ao completar interpretação (${reading.reference}):`, err.message);
      if (++consecutiveFailures >= 3) break;
    }
    await sleep(delay);
  }

  return { pending: pending.length, done };
}
