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

function setXml(tag: string, values: string[], itemTag = tag.replace(/Set$/, "")): string {
  if (values.length === 0) return "";
  return `<${tag}>${values.map(value => `<${itemTag}>${xml(value)}</${itemTag}>`).join("")}</${tag}>`;
}

function datesXml(values: string[]): string {
  if (values.length === 0) return "";
  return `<dateSet>${values.map(value => `<date><earliestDate>${xml(value)}</earliestDate></date>`).join("")}</dateSet>`;
}

function locationsXml(values: string[]): string {
  if (values.length === 0) return "";
  return `<locationSet>${values.map(value => `<location><name>${xml(value)}</name></location>`).join("")}</locationSet>`;
}

function agentsXml(values: string[]): string {
  if (values.length === 0) return "";
  return `<agentSet>${values.map(value => `<agent><name>${xml(value)}</name></agent>`).join("")}</agentSet>`;
}

function inscriptionsXml(values: string[]): string {
  if (values.length === 0) return "";
  return `<inscriptionSet>${values.map(value => `<inscription><text>${xml(value)}</text></inscription>`).join("")}</inscriptionSet>`;
}

function recordXml(record: VisualExportRecord, relations: VisualExportRelation[]): string {
  const ownRelations = relations.filter(relation => relation.sourceRecordId === record.id);
  const relationXml = ownRelations.length ? `<relationSet>${ownRelations.map(relation => `<relation type="${xml(relation.relationType)}" refid="${xml(relation.targetRecordId)}"/>`).join("")}</relationSet>` : "";
  const refid = record.localIdentifier || record.id;
  const fieldOrder = [
    agentsXml(values(record, "agents")),
    setXml("culturalContextSet", values(record, "culturalContext"), "culturalContext"),
    datesXml(values(record, "dates")),
    setXml("descriptionSet", values(record, "description"), "description"),
    inscriptionsXml(values(record, "inscriptions")),
    locationsXml(values(record, "locations")),
    setXml("materialSet", values(record, "materials"), "material"),
    relationXml,
    setXml("stylePeriodSet", values(record, "stylePeriod"), "stylePeriod"),
    setXml("subjectSet", values(record, "subjects"), "subject"),
    setXml("techniqueSet", values(record, "techniques"), "technique"),
    `<titleSet><title>${xml(record.title)}</title></titleSet>`,
    setXml("worktypeSet", values(record, "workType"), "worktype"),
  ].join("");
  return `<${record.recordType} id="turath_${record.id.replace(/-/g, "_")}" refid="${xml(refid)}">${fieldOrder}</${record.recordType}>`;
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

export function downloadTextFile(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
