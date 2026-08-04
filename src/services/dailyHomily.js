import * as cheerio from "cheerio";

let cache = {
  date: null,
  data: null,
};

export async function getDailyHomily() {
  const today = new Date().toISOString().split("T")[0];
  if (cache.date === today && cache.data) {
    return cache.data;
  }

  try {
    const response = await fetch("https://homilia.cancaonova.com/pb/");

    if (!response.ok) {
      throw new Error(`Erro na requisição: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    let title = $("h1.entry-title span").text().trim();
    if (!title) {
      title = $("h1.entry-title").text().trim();
    }

    const content = $("div.entry-content.content-homilia")
      .children("p, h3")
      .map((_, element) => $(element).text().trim())
      .get()
      .filter(Boolean)
      .join("\n\n");

    if (!title && !content) {
      throw new Error("Não foi possível extrair o título e o conteúdo da página.");
    }

    const result = {
      success: true,
      date: today,
      title: title || "Reflexão Diária",
      content,
    };

    cache = { date: today, data: result };
    return result;
  } catch (error) {
    console.error("Erro ao fazer scraping:", error.message);
    throw error;
  }
}
