# Daily Prayer API

API RESTful para leitura bíblica diária, homilia do evangelho e interpretações dos três blocos de leitura geradas por IA. Construída com Node.js, hospedada na Vercel como Serverless Functions, com banco de dados PostgreSQL no Neon.

---

## Arquitetura

```
daily-prayer-api/
├── api/                          # Serverless Functions (Vercel)
│   ├── cron/
│   │   ├── daily-reading.js      # Cron: gera os 3 blocos de leitura diária
│   │   └── daily-verse.js        # Cron: gera o versículo do dia + reflexão IA
│   ├── daily-reading.js          # GET /api/daily-reading
│   ├── daily-reflection.js       # GET /api/daily-reflection
│   └── verse-of-the-day.js       # GET /api/verse-of-the-day
├── src/
│   ├── lib/
│   │   ├── categories.js         # Mapeamento dos livros por categoria
│   │   └── db.js                 # Módulo de conexão com o Neon Postgres
│   ├── routes/
│   │   └── dailyPrayer.js        # Rota Express (dev local)
│   ├── services/
│   │   ├── dailyDiscovery.js     # Web scraping da Homilia (Canção Nova)
│   │   └── translate.js          # Serviço de tradução
│   └── server.js                 # Servidor Express (dev local)
├── seed.js                       # Script de seed da Bíblia no banco
├── vercel.json                   # Configuração do Cron Job na Vercel
├── package.json
└── .env                          # Variáveis de ambiente (não versionado)
```

---

## Tecnologias

| Tecnologia | Uso |
|---|---|
| **Node.js** | Runtime |
| **Vercel Serverless Functions** | Hospedagem e execução dos endpoints |
| **Vercel Cron Jobs** | Agendamento diário automático |
| **PostgreSQL (Neon)** | Banco de dados serverless |
| **@neondatabase/serverless** | Driver de conexão com o Neon |
| **@google/genai** | SDK do Google Gemini para reflexões por IA |
| **Cheerio** | Web scraping da Homilia diária |

---

## Banco de Dados

### Tabela `verses`

Armazena todos os versículos da Bíblia Ave Maria (~35.450 registros).

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | `SERIAL PK` | ID sequencial do versículo |
| `book_name` | `VARCHAR` | Nome do livro (ex: "Gênesis") |
| `chapter` | `INT` | Número do capítulo |
| `verse` | `INT` | Número do versículo |
| `text` | `TEXT` | Texto do versículo |

### Tabela `daily_verses`

Armazena o versículo do dia com a reflexão gerada pela IA.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | `SERIAL PK` | ID do registro |
| `verse_id` | `INT` | FK para `verses.id` |
| `date` | `DATE` | Data do versículo |
| `reflection` | `TEXT` | Reflexão gerada pelo Gemini |
| `created_at` | `TIMESTAMP` | Data de criação |

### Tabela `daily_readings`

Armazena os 3 blocos de leitura diária por categoria.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | `SERIAL PK` | ID do registro |
| `date` | `DATE` | Data da leitura |
| `category` | `VARCHAR(50)` | Identificador da categoria |
| `category_title` | `VARCHAR(100)` | Nome exibido da categoria |
| `start_verse_id` | `INT` | ID do primeiro versículo do trecho |
| `end_verse_id` | `INT` | ID do último versículo do trecho |
| `reference` | `VARCHAR(150)` | Referência bíblica (ex: "Gênesis 1:1-12") |
| `text` | `TEXT` | Texto completo do trecho |
| `reflection` | `TEXT` | Interpretação do trecho gerada pelo Gemini |
| `estimated_time` | `VARCHAR(20)` | Tempo estimado de leitura |
| `created_at` | `TIMESTAMP` | Data de criação |

**Constraint**: `UNIQUE (date, category)` — garante apenas 1 bloco por categoria por dia.

### Migração necessária

Antes de publicar esta alteração, aplique a migração abaixo no banco Neon para criar a coluna que armazena as três interpretações diárias:

```sql
ALTER TABLE daily_readings ADD COLUMN IF NOT EXISTS reflection TEXT;
```

O mesmo comando está em `migrations/001_add_daily_readings_reflection.sql`.

---

## Endpoints

### `GET /api/daily-reading`

Retorna os 3 blocos de leitura diária em ordem sequencial pela Bíblia.

**Categorias**:
1. **Antigo Testamento** — Gênesis a Malaquias (História, Lei, Profetas)
2. **Poesia e Sabedoria** — Jó, Salmos, Provérbios, Eclesiastes, Cântico dos Cânticos, Sabedoria, Eclesiástico
3. **Cartas e Epístolas** — Romanos a Apocalipse

> Evangelhos (Mateus, Marcos, Lucas, João) e Atos dos Apóstolos são **excluídos** deste endpoint.

**Resposta** (`200 OK`):

```json
{
  "date": "2026-07-30",
  "total_estimated_time": "~6 a 8 min",
  "readings": [
    {
      "id": "at_historia",
      "titulo_categoria": "Antigo Testamento",
      "referencia": "Gênesis 1:1-12",
      "tempo_estimado": "~2 a 3 min",
      "texto": "1. No princípio, Deus criou o céu e a terra.\n2. A terra estava...",
      "reflexao": "Este trecho apresenta Deus como origem de toda a criação..."
    },
    {
      "id": "poesia_sabedoria",
      "titulo_categoria": "Poesia e Sabedoria",
      "referencia": "Jó 1:1-12",
      "tempo_estimado": "~2 a 3 min",
      "texto": "1. Havia, na terra de Hus, um homem chamado Jó..."
    },
    {
      "id": "cartas_epistolas",
      "titulo_categoria": "Cartas e Epístolas",
      "referencia": "Romanos 1:1-12",
      "tempo_estimado": "~2 a 3 min",
      "texto": "1. Paulo, servo de Jesus Cristo..."
    }
  ]
}
```

---

### `GET /api/daily-reflection`

Retorna a Homilia Diária do Evangelho do dia, obtida via web scraping do site da Canção Nova.

**Resposta** (`200 OK`):

```json
{
  "success": true,
  "date": "2026-07-30",
  "title": "Verdadeiro tesouro no reino dos céus",
  "content": "Então Jesus acrescentou assim: "Assim pois todo mestre da lei..."
}
```

---

### `GET /api/verse-of-the-day`

Retorna 1 versículo do dia na ordem sequencial da Bíblia com uma reflexão teológica gerada pelo Google Gemini.

**Resposta** (`200 OK`):

```json
{
  "date": "2026-07-30",
  "reference": "Gênesis 1:2",
  "book": "Gênesis",
  "chapter": 1,
  "verse": 2,
  "text": "A terra estava sem forma e vazia; as trevas cobriam o abismo...",
  "reflection": "Este versículo nos apresenta o estado primordial da criação..."
}
```

---

## Cron Jobs

Configurados no `vercel.json` e executados automaticamente pela Vercel.

| Rota | Schedule | Descrição |
|---|---|---|
| `/api/cron/daily-reading` | `0 3 * * *` (03:00 UTC) | Gera os 3 blocos de leitura do dia |

Os cron jobs são protegidos pelo header `Authorization: Bearer CRON_SECRET`.

Caso o cron não tenha sido executado antes da primeira requisição do dia, o endpoint público `/api/daily-reading` gera os dados automaticamente no momento da chamada. Para cada bloco diário, é feita uma chamada ao Gemini e a interpretação é salva junto à leitura.

---

## ariáveis de Ambiente

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Connection string do PostgreSQL no Neon |
| `CRON_SECRET` | Token Bearer para autenticar os cron jobs da Vercel |
| `GEMINI_API_KEY` | Chave de API do Google Gemini |

---

## Setup Local

### 1. Clonar o repositório

```bash
git clone https://github.com/Arggusx/daily-prayer-api.git
cd daily-prayer-api
```

### 2. Instalar dependências

```bash
npm install
```

### 3. Configurar variáveis de ambiente

Crie um arquivo `.env` na raiz:

```env
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
CRON_SECRET=seu_token_secreto
GEMINI_API_KEY=sua_chave_gemini
```

### 4. Popular o banco de dados

Baixe o arquivo `bibliaAveMaria.json` do repositório [fidalgobr/bibliaAveMariaJSON](https://github.com/fidalgobr/bibliaAveMariaJSON) e coloque na raiz do projeto.

```bash
npm run seed
```

### 5. Rodar localmente

```bash
npm run dev
```

---

## Deploy na Vercel

1. Faça o push do projeto para o GitHub.
2. Importe o repositório na Vercel.
3. Adicione as variáveis de ambiente (`DATABASE_URL`, `CRON_SECRET`, `GEMINI_API_KEY`) em **Settings > Environment Variables**.
4. O deploy será feito automaticamente e o cron job ficará ativo.

---

## Lógica de Progresso Sequencial

A leitura avança diariamente sem repetir versículos:

- Cada categoria mantém seu próprio ponteiro de progresso (`end_verse_id`).
- A cada dia, o sistema busca os próximos ~12 versículos a partir de onde parou no dia anterior.
- Os 3 blocos avançam **independentemente**: o Antigo Testamento pode estar em Êxodo enquanto Poesia & Sabedoria está em Salmos.
- Ao concluir todos os versículos de uma categoria, o ciclo reinicia automaticamente do primeiro versículo daquela categoria.
- A Bíblia completa é lida em aproximadamente **2 a 2,5 anos** no ritmo de ~6 a 8 minutos por dia.
