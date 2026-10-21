import * as cheerio from "cheerio";
import { todayInBrazil } from "../lib/dates.js";

const HOMILY_PAGE = "https://homilia.cancaonova.com/pb/";

// A homilia é conteúdo autoral da Canção Nova ("todos os direitos reservados").
// Por isso a API devolve só um trecho curto e o link para o texto completo no site deles.
const EXCERPT_MIN = 280;
const EXCERPT_MAX = 600;

let cache = {
  date: null,
  data: null,
};

// Muitas homilias começam citando o Evangelho ("Naquele tempo…" ou um trecho entre aspas).
// O trecho deve mostrar a reflexão do padre, então essas citações iniciais são puladas.
const GOSPEL_QUOTE = /^(Naquele tempo|Em verdade|[“"«])/;

/** Primeiros parágrafos da reflexão até ~EXCERPT_MIN caracteres, cortando no fim de uma frase. */
function buildExcerpt(paragraphs) {
  const firstReflection = paragraphs.findIndex((text) => !GOSPEL_QUOTE.test(text));
  const candidates = firstReflection >= 0 ? paragraphs.slice(firstReflection) : paragraphs;

  let excerpt = "";
  for (const paragraph of candidates) {
    excerpt = excerpt ? `${excerpt}\n\n${paragraph}` : paragraph;
    if (excerpt.length >= EXCERPT_MIN) break;
  }
  if (excerpt.length <= EXCERPT_MAX) return excerpt;

  const cut = excerpt.slice(0, EXCERPT_MAX);
  const lastSentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return lastSentenceEnd > EXCERPT_MIN ? cut.slice(0, lastSentenceEnd + 1) : `${cut.trimEnd()}…`;
}

/** Link direto da homilia do dia (a página lista links com sDia/sMes/sAno). */
function findTodayUrl($, isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const suffix = `sDia=${day}&sMes=${month}&sAno=${year}`;
  const href = $(`a[href*="/pb/homilia/"]`)
    .map((_, a) => $(a).attr("href"))
    .get()
    .find((link) => link.includes(suffix));
  return href || HOMILY_PAGE;
}

export async function getDailyHomily() {
  const today = todayInBrazil();
  if (cache.date === today && cache.data) {
    return cache.data;
  }

  try {
    const response = await fetch(HOMILY_PAGE);

    if (!response.ok) {
      throw new Error(`Erro na requisição: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    let title = $("h1.entry-title span").text().trim();
    if (!title) {
      title = $("h1.entry-title").text().trim();
    }

    // Só parágrafos: os h3 são subtítulos e não fazem sentido soltos no trecho.
    const paragraphs = $("div.entry-content.content-homilia")
      .children("p")
      .map((_, element) => $(element).text().trim())
      .get()
      .filter(Boolean);

    if (!title && paragraphs.length === 0) {
      throw new Error("Não foi possível extrair o título e o conteúdo da página.");
    }

    const excerpt = buildExcerpt(paragraphs);

    const result = {
      success: true,
      date: today,
      title: title || "Reflexão Diária",
      excerpt,
      // Mantido por compatibilidade com versões anteriores do site: agora também é só o trecho.
      content: excerpt,
      url: findTodayUrl($, today),
      source: "Canção Nova",
    };

    cache = { date: today, data: result };
    return result;
  } catch (error) {
    console.error("Erro ao fazer scraping:", error.message);
    throw error;
  }
}
