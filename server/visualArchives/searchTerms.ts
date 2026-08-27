const searchStopWords = new Set([
  "a", "about", "an", "and", "approved", "are", "as", "at", "be", "between", "by",
  "appear", "catalog", "do", "does", "for", "from", "have", "image", "images", "in", "is",
  "it", "me", "of", "on", "or", "photo", "photograph", "photographs", "picture", "recur",
  "recurring", "show", "shows", "tell", "that", "the", "these", "this",
  "those", "to", "was", "were", "what", "which", "who", "with",
]);

const searchAliases: Record<string, string> = {
  creator: "agents",
  creators: "agents",
  date: "dates",
  location: "locations",
  material: "materials",
  photographer: "agents",
  photographers: "agents",
  place: "locations",
  places: "locations",
  subject: "subjects",
  technique: "techniques",
};

export function normalizeVisualSearchText(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

function stemEnglishPlural(token: string): string {
  if (!/^[a-z]+$/.test(token)) return token;
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function visualQueryTerms(query: string): string[] {
  const terms = normalizeVisualSearchText(query)
    .split(/[^a-z0-9\u00c0-\u024f\u0600-\u06ff]+/i)
    .filter(token => token.length >= 2 && !searchStopWords.has(token))
    .map(stemEnglishPlural)
    .map(token => searchAliases[token] ?? token);
  return Array.from(new Set(terms));
}

export function canonicalVisualSearchText(value: string): string {
  const normalized = normalizeVisualSearchText(value);
  return `${normalized} ${visualQueryTerms(normalized).join(" ")}`.trim();
}
