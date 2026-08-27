export type VisualExportRecord = {
  id: string;
  recordType: "collection" | "work" | "image";
  title: string;
  localIdentifier: string | null;
  status: string;
  reviewedJson: Record<string, unknown>;
  assetId: string | null;
};

export type VisualExportRelation = {
  sourceRecordId: string;
  targetRecordId: string;
  relationType: string;
};

export type VisualCatalogExport = {
  profile: string;
  exportedAt: string;
  projectId: number;
  includeUnapproved: boolean;
  records: VisualExportRecord[];
  relations: VisualExportRelation[];
};

function xml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function values(record: VisualExportRecord, field: string): string[] {
  const value = record.reviewedJson[field];
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function setXml(tag: string, entries: string[], itemTag = tag.replace(/Set$/, "")): string {
  if (entries.length === 0) return "";
  return `<${tag}>${entries.map(entry => `<${itemTag}>${xml(entry)}</${itemTag}>`).join("")}</${tag}>`;
}

function recordXml(record: VisualExportRecord, relations: VisualExportRelation[]): string {
  const ownRelations = relations.filter(relation => relation.sourceRecordId === record.id);
  const relationXml = ownRelations.length ? `<relationSet>${ownRelations.map(relation => `<relation type="${xml(relation.relationType)}" refid="${xml(relation.targetRecordId)}"/>`).join("")}</relationSet>` : "";
  const dates = values(record, "dates");
  const locations = values(record, "locations");
  const agents = values(record, "agents");
  const inscriptions = values(record, "inscriptions");
  const refid = record.localIdentifier || record.id;
  const fields = [
    agents.length ? `<agentSet>${agents.map(value => `<agent><name>${xml(value)}</name></agent>`).join("")}</agentSet>` : "",
    setXml("culturalContextSet", values(record, "culturalContext"), "culturalContext"),
    dates.length ? `<dateSet>${dates.map(value => `<date><earliestDate>${xml(value)}</earliestDate></date>`).join("")}</dateSet>` : "",
    setXml("descriptionSet", values(record, "description"), "description"),
    inscriptions.length ? `<inscriptionSet>${inscriptions.map(value => `<inscription><text>${xml(value)}</text></inscription>`).join("")}</inscriptionSet>` : "",
    locations.length ? `<locationSet>${locations.map(value => `<location><name>${xml(value)}</name></location>`).join("")}</locationSet>` : "",
    setXml("materialSet", values(record, "materials"), "material"),
    relationXml,
    setXml("stylePeriodSet", values(record, "stylePeriod"), "stylePeriod"),
    setXml("subjectSet", values(record, "subjects"), "subject"),
    setXml("techniqueSet", values(record, "techniques"), "technique"),
    `<titleSet><title>${xml(record.title)}</title></titleSet>`,
    setXml("worktypeSet", values(record, "workType"), "worktype"),
  ].join("");
  return `<${record.recordType} id="turath_${record.id.replace(/-/g, "_")}" refid="${xml(refid)}">${fields}</${record.recordType}>`;
}

export function buildVraCoreXml(data: VisualCatalogExport): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<vra xmlns="http://www.vraweb.org/vracore4.htm" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.vraweb.org/vracore4.htm https://www.loc.gov/standards/vracore/vra.xsd">${data.records.map(record => recordXml(record, data.relations)).join("")}</vra>`;
}

function csvCell(value: unknown): string {
  const cell = typeof value === "string" ? value : Array.isArray(value) ? value.join("; ") : value == null ? "" : JSON.stringify(value);
  return `"${cell.replaceAll("\"", "\"\"")}"`;
}

export function buildVisualCatalogCsv(data: VisualCatalogExport): string {
  const fields = ["id", "recordType", "title", "localIdentifier", "status", "description", "workType", "agents", "dates", "locations", "subjects", "culturalContext", "materials", "techniques", "inscriptions", "stylePeriod"];
  const rows = data.records.map(record => fields.map(field => csvCell(field in record ? record[field as keyof VisualExportRecord] : record.reviewedJson[field])).join(","));
  return [fields.join(","), ...rows].join("\n");
}
