import { createHmac } from "node:crypto";
import { todayInBrazil } from "./dates.js";

// Novenas que o site oferece (o mesmo id de src/data/novenas.js no Oratio).
export const NOVENA_IDS = ["espirito-santo", "natal", "aparecida", "santo-antonio"];

const INTENTION_MAX = 280;
const NAME_MAX = 30;
const INTENTIONS_PER_DAY = 3; // por IP (hash diário) e por aparelho
const INTENTION_DAYS = 30; // pedidos somem do mural depois disso
const REPORTS_TO_HIDE = 3;
const PAGE_SIZE = 20;
const ACTIONS_PER_IP_DAY = 60; // marcações e "rezei por você" vindos do mesmo IP num dia

export class CommunityError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function secret() {
  const key = process.env.COMMUNITY_SECRET;
  if (!key || key.length < 16) throw new Error("COMMUNITY_SECRET não está definida (mínimo 16 caracteres).");
  return key;
}

/**
 * O aparelho manda um código aleatório; guardamos só o HMAC dele. Sem a chave do servidor não dá para
 * ligar o registro ao aparelho, e o código em si não diz nada sobre a pessoa.
 */
export function participantHash(anonId) {
  if (typeof anonId !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(anonId)) {
    throw new CommunityError(400, "Código do aparelho inválido.");
  }
  return createHmac("sha256", secret()).update(`p:${anonId}`).digest("hex").slice(0, 32);
}

/** Hash do IP que muda todo dia: serve só para limitar envios no mesmo dia. */
export function ipHash(ip, day = todayInBrazil()) {
  return createHmac("sha256", secret()).update(`ip:${day}:${ip || "?"}`).digest("hex").slice(0, 32);
}

/**
 * Limpa o texto do mural: tira links, e-mails e telefones (o mural não é lugar de contato nem de propaganda),
 * espaços repetidos e caracteres de controle.
 */
export function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link removido]")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "[e-mail removido]")
    .replace(/(?:\+?\d[\s().-]?){8,}/g, "[telefone removido] ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Palavras que não cabem num mural de oração. A lista é curta de propósito: o resto fica com as denúncias.
const BLOCKED = /\b(porra|caralho|merda|puta|viado|buceta|cu|foda|fdp|vagabund[ao])\b/i;

export function validateIntention({ text, firstName }) {
  const cleanIntention = cleanText(text, INTENTION_MAX);
  const cleanName = cleanText(firstName ?? "", NAME_MAX).split(" ")[0] || null;
  if (cleanIntention.length < 5) throw new CommunityError(400, "Escreva o seu pedido (pelo menos 5 letras).");
  if (BLOCKED.test(cleanIntention) || (cleanName && BLOCKED.test(cleanName))) {
    throw new CommunityError(400, "O pedido tem palavras que não cabem no mural.");
  }
  return { text: cleanIntention, firstName: cleanName };
}

// Teto por IP: impede que alguém infle os números gerando códigos de aparelho novos.
async function checkIpLimit(sql, table, ipKey) {
  const [{ n }] = await sql.query(
    `SELECT count(*)::int AS n FROM ${table} WHERE ip_hash = $1 AND created_at > now() - interval '1 day'`,
    [ipKey]
  );
  if (n >= ACTIONS_PER_IP_DAY) throw new CommunityError(429, "Muitas marcações a partir desta conexão. Tente amanhã.");
}

/** Marca um terço ou um dia de novena. Repetir no mesmo dia não conta de novo. */
export async function recordEvent(sql, { kind, ref, participant, ip }) {
  if (kind === "terco") ref = "";
  else if (kind === "novena") {
    if (!NOVENA_IDS.includes(ref)) throw new CommunityError(400, "Novena desconhecida.");
  } else throw new CommunityError(400, "Tipo de marcação inválido.");

  const ipKey = ipHash(ip);
  await checkIpLimit(sql, "community_events", ipKey);
  await sql.query(
    `INSERT INTO community_events (kind, ref, day, participant, ip_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (kind, ref, day, participant) DO NOTHING`,
    [kind, ref, todayInBrazil(), participant, ipKey]
  );
}

/** Números da comunidade: terços de hoje, quem está fazendo cada novena e as metas em andamento. */
export async function getStats(sql) {
  const today = todayInBrazil();
  const [[terco], novenas, goals] = await Promise.all([
    sql.query(
      `SELECT count(DISTINCT participant)::int AS n FROM community_events WHERE kind = 'terco' AND day = $1`,
      [today]
    ),
    // Quem marcou algum dia da novena nos últimos 9 dias está "fazendo a novena".
    sql.query(
      `SELECT ref, count(DISTINCT participant)::int AS n FROM community_events
       WHERE kind = 'novena' AND day > ($1::date - 9)
       GROUP BY ref`,
      [today]
    ),
    sql.query(
      `SELECT g.id, g.title, g.target, g.starts_on::text AS "startsOn", g.ends_on::text AS "endsOn",
              (SELECT count(*)::int FROM community_events e
               WHERE e.kind = g.kind AND e.day BETWEEN g.starts_on AND g.ends_on) AS progress
       FROM community_goals g
       WHERE $1::date BETWEEN g.starts_on - 14 AND g.ends_on
       ORDER BY g.starts_on`,
      [today]
    ),
  ]);

  return {
    date: today,
    tercoToday: terco?.n ?? 0,
    novenas: Object.fromEntries(novenas.map((r) => [r.ref, r.n])),
    goals,
  };
}

export async function listIntentions(sql, { participant = null, before = null } = {}) {
  const rows = await sql.query(
    `SELECT i.id::text AS id, i.text, i.first_name AS "firstName", i.created_at AS "createdAt",
            (SELECT count(*)::int FROM community_intention_prayers p WHERE p.intention_id = i.id) AS prayers,
            EXISTS (SELECT 1 FROM community_intention_prayers p
                    WHERE p.intention_id = i.id AND p.participant = $1) AS "prayedByMe"
     FROM community_intentions i
     WHERE NOT i.hidden
       AND i.created_at > now() - ($2::int * interval '1 day')
       AND ($3::bigint IS NULL OR i.id < $3::bigint)
     ORDER BY i.id DESC
     LIMIT ${PAGE_SIZE}`,
    [participant, INTENTION_DAYS, before]
  );
  return rows;
}

export async function createIntention(sql, { text, firstName, participant, ip }) {
  const clean = validateIntention({ text, firstName });
  const ipKey = ipHash(ip);

  const [{ n }] = await sql.query(
    `SELECT count(*)::int AS n FROM community_intentions
     WHERE created_at > now() - interval '1 day' AND (ip_hash = $1 OR participant = $2)`,
    [ipKey, participant]
  );
  if (n >= INTENTIONS_PER_DAY) {
    throw new CommunityError(429, "Você já deixou 3 pedidos hoje. Volte amanhã.");
  }

  const [row] = await sql.query(
    `INSERT INTO community_intentions (text, first_name, ip_hash, participant)
     VALUES ($1, $2, $3, $4)
     RETURNING id::text AS id, text, first_name AS "firstName", created_at AS "createdAt"`,
    [clean.text, clean.firstName, ipKey, participant]
  );
  return { ...row, prayers: 0, prayedByMe: false };
}

function parseId(id) {
  if (typeof id !== "string" && typeof id !== "number") throw new CommunityError(400, "Pedido inválido.");
  if (!/^[1-9]\d{0,17}$/.test(String(id))) throw new CommunityError(400, "Pedido inválido.");
  return String(id);
}

/** "Rezei por você": uma vez por pessoa. Devolve o total atualizado. */
export async function prayForIntention(sql, { id, participant, ip }) {
  const intentionId = parseId(id);
  const ipKey = ipHash(ip);
  await checkIpLimit(sql, "community_intention_prayers", ipKey);
  const [exists] = await sql.query(`SELECT 1 FROM community_intentions WHERE id = $1 AND NOT hidden`, [intentionId]);
  if (!exists) throw new CommunityError(404, "Pedido não encontrado.");
  await sql.query(
    `INSERT INTO community_intention_prayers (intention_id, participant, ip_hash) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [intentionId, participant, ipKey]
  );
  const [{ n }] = await sql.query(
    `SELECT count(*)::int AS n FROM community_intention_prayers WHERE intention_id = $1`,
    [intentionId]
  );
  return { id: intentionId, prayers: n };
}

/** Denúncia: com 3 conexões (IPs) diferentes, o pedido sai do mural. */
export async function reportIntention(sql, { id, participant, ip }) {
  const intentionId = parseId(id);
  const ipKey = ipHash(ip);
  await checkIpLimit(sql, "community_intention_reports", ipKey);
  await sql.query(
    `INSERT INTO community_intention_reports (intention_id, participant, ip_hash)
     SELECT id, $2, $3 FROM community_intentions WHERE id = $1
     ON CONFLICT DO NOTHING`,
    [intentionId, participant, ipKey]
  );
  await sql.query(
    `UPDATE community_intentions SET hidden = true
     WHERE id = $1
       AND (SELECT count(DISTINCT ip_hash) FROM community_intention_reports WHERE intention_id = $1) >= $2`,
    [intentionId, REPORTS_TO_HIDE]
  );
  return { id: intentionId, reported: true };
}
