import { canonicalVisualSearchText, visualQueryTerms } from "./searchTerms";

type CatalogRecord = { id: string; title: string; localIdentifier?: string | null; reviewedJson: unknown };
const synonyms = [
  ["tram", "streetcar", "tramway"], ["cinema", "film", "movie"],
  ["balcony", "balconies"], ["mosque", "masjid"], ["cairo", "القاهرة"],
];
const generic = new Set(["collection", "record", "catalog", "associated", "depict", "pictured", "compare", "other", "same", "more", "building", "site"]);

export function dateRange(query: string): [number, number] | undefined {
  const match = query.match(/\b(\d{4})\s*(?:[-–—]|to|and)\s*(\d{4})\b/i);
  return match ? [Math.min(+match[1], +match[2]), Math.max(+match[1], +match[2])] : undefined;
}

export function rankCatalog<T extends CatalogRecord>(records: T[], query: string, range = dateRange(query)) {
  const terms = visualQueryTerms(query).filter(term => !range || !/^\d{4}$/.test(term));
  return records.map(record => {
    const fields = (record.reviewedJson ?? {}) as Record<string, unknown>;
    const values = Object.values(fields).flatMap(value => Array.isArray(value) ? value : [value]).filter(value => typeof value === "string");
    const title = canonicalVisualSearchText(`${record.title} ${record.localIdentifier ?? ""}`);
    // Search values, never empty schema keys: "materials" must not match every record.
    const text = canonicalVisualSearchText(values.join(" "));
    const matchedTerms = terms.filter(term => (synonyms.find(group => group.includes(term)) ?? [term]).some(word => title.includes(word) || text.includes(word)));
    const years = JSON.stringify(fields.dates ?? []).match(/\b\d{4}\b/g)?.map(Number) ?? [];
    const inRange = !range || (years.length > 0 && Math.min(...years) <= range[1] && Math.max(...years) >= range[0]);
    const fieldQuestion = terms.filter(term => !generic.has(term));
    const hasRequestedField = fieldQuestion.length > 0 && fieldQuestion.every(term => Object.hasOwn(fields, term) && JSON.stringify(fields[term]) !== "[]" && Boolean(fields[term]));
    const score = matchedTerms.reduce((sum, term) => sum + (title.includes(term) ? 5 : 1), 0) + (hasRequestedField ? 1 : 0);
    return { record, score, matchedTerms, inRange };
  }).filter(item => item.inRange && (terms.length === 0 || item.score > 0))
    .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
}

export function isContextualQuestion(question: string) {
  return /\b(those|these|them|same|other|more|compare|that|this work|this site)\b/i.test(question);
}

export function selectEvidence<T extends CatalogRecord>(ranked: T[], approved: T[], contextIds: string[], relations: Array<{ sourceRecordId: string; targetRecordId: string }>, contextual: boolean, limit = 12) {
  const byId = new Map(approved.map(record => [record.id, record]));
  const anchors = contextual ? contextIds.filter(id => byId.has(id)) : [];
  const seeds = Array.from(new Set([...anchors, ...ranked.slice(0, 6).map(record => record.id)]));
  const safeRelations = relations.filter(relation => byId.has(relation.sourceRecordId) && byId.has(relation.targetRecordId));
  const related = safeRelations.flatMap(relation => seeds.includes(relation.sourceRecordId) ? [relation.targetRecordId] : seeds.includes(relation.targetRecordId) ? [relation.sourceRecordId] : []);
  // Two hops cover Image -> Work -> sibling Images without traversing hidden records.
  const siblings = safeRelations.flatMap(relation => related.includes(relation.sourceRecordId) ? [relation.targetRecordId] : related.includes(relation.targetRecordId) ? [relation.sourceRecordId] : []);
  return Array.from(new Set([...anchors, ...seeds, ...related, ...siblings, ...ranked.map(record => record.id)]))
    .flatMap(id => byId.has(id) ? [byId.get(id)!] : []).slice(0, limit);
}
