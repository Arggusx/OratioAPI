import "dotenv/config";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL não encontrada. Crie um arquivo .env com a variável.");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const raw = readFileSync("bibliaAveMaria.json", "utf-8");
const biblia = JSON.parse(raw);

let livros = [];
if (Array.isArray(biblia)) {
  livros = biblia;
} else if (biblia.antigoTestamento) {
  livros = livros.concat(biblia.antigoTestamento);
  if (biblia.novoTestamento) {
    livros = livros.concat(biblia.novoTestamento);
  }
} else {
  console.error("❌ Formato do JSON não reconhecido. Esperado: { antigoTestamento: [...] }");
  process.exit(1);
}

const verses = [];
let id = 1;

for (const livro of livros) {
  const bookName = livro.nome;
  for (const cap of livro.capitulos) {
    const chapter = cap.capitulo;
    for (const vers of cap.versiculos) {
      verses.push({
        id,
        book_name: bookName,
        chapter,
        verse: vers.versiculo,
        text: vers.texto,
      });
      id++;
    }
  }
}

console.log(`📖 Total de versículos encontrados: ${verses.length}`);

const BATCH_SIZE = 100;

async function seed() {
  console.log("🚀 Iniciando seed no banco de dados...\n");

  let inserted = 0;

  for (let i = 0; i < verses.length; i += BATCH_SIZE) {
    const batch = verses.slice(i, i + BATCH_SIZE);

    const placeholders = batch.map((_, idx) => {
      const offset = idx * 5;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
    });

    const values = batch.flatMap((v) => [v.id, v.book_name, v.chapter, v.verse, v.text]);

    const query = `
      INSERT INTO verses (id, book_name, chapter, verse, text)
      VALUES ${placeholders.join(", ")}
      ON CONFLICT (id) DO NOTHING
    `;

    await sql.query(query, values);
    inserted += batch.length;

    if (inserted % 1000 === 0 || inserted === verses.length) {
      console.log(`  ✅ ${inserted} / ${verses.length} versículos inseridos...`);
    }
  }

  console.log(`\n🎉 Seed concluído! ${verses.length} versículos processados.`);
}

seed().catch((err) => {
  console.error("❌ Erro durante o seed:", err);
  process.exit(1);
});
