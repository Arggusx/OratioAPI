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

function parseHomily($) {
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

  return { title, paragraphs };
}

/** Links de homilias listados na página, com a data de cada uma (sDia/sMes/sAno). */
function datedHomilyLinks($) {
  const links = $(`a[href*="/pb/homilia/"]`)
    .map((_, a) => $(a).attr("href"))
    .get()
    .map((href) => {
      const params = new URL(href, HOMILY_PAGE).searchParams;
      const [day, month, year] = ["sDia", "sMes", "sAno"].map((key) => Number(params.get(key)));
      if (!day || !month || !year) return null;
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return { href, date };
    })
    .filter(Boolean);
  return [...new Map(links.map((link) => [link.date, link])).values()];
}

async function loadPage(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Erro na requisição: ${response.status}`);
  }
  return cheerio.load(await response.text());
}

// Enquanto só existe a homilia de um dia anterior, a resposta é guardada por pouco
// tempo, para a de hoje aparecer logo que a Canção Nova publicar.
const FALLBACK_CACHE_MS = 15 * 60_000;

export async function getDailyHomily() {
  const today = todayInBrazil();
  if (cache.date === today && cache.data && (!cache.expiresAt || Date.now() < cache.expiresAt)) {
    return cache.data;
  }

  try {
    const $page = await loadPage(HOMILY_PAGE);
    const links = datedHomilyLinks($page);
    let { title, paragraphs } = parseHomily($page);
    let date = today;
    let url = links.find((link) => link.date === today)?.href || HOMILY_PAGE;

    // Logo após a meia-noite a página principal fica vazia até a homilia do dia ser
    // publicada. Nesse intervalo, usamos a homilia mais recente já publicada.
    if (paragraphs.length === 0) {
      const latest = links
        .filter((link) => link.date <= today)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (latest) {
        ({ title, paragraphs } = parseHomily(await loadPage(latest.href)));
        date = latest.date;
        url = latest.href;
      }
    }

    if (paragraphs.length === 0) {
      throw new Error("Não foi possível extrair o conteúdo da homilia.");
    }

    const excerpt = buildExcerpt(paragraphs);

    const result = {
      success: true,
      date,
      // true quando a homilia de hoje ainda não foi publicada e esta é a mais recente.
      isFromPreviousDay: date !== today,
      title: title || "Homilia do dia",
      excerpt,
      // Mantido por compatibilidade com versões anteriores do site: agora também é só o trecho.
      content: excerpt,
      url,
      source: "Canção Nova",
    };

    cache = {
      date: today,
      data: result,
      expiresAt: result.isFromPreviousDay ? Date.now() + FALLBACK_CACHE_MS : null,
    };
    return result;
  } catch (error) {
    console.error("Erro ao fazer scraping:", error.message);
    throw error;
  }
}
