// As leituras são do "dia litúrgico" brasileiro: usar a data UTC fazia o
// site virar o dia às 21h no Brasil.
const TIME_ZONE = "America/Sao_Paulo";

export function todayInBrazil() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
}

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}
