import { describe, expect, it } from "vitest";
import { buildVisualCatalogCsv, buildVraCoreXml, type VisualCatalogExport } from "../client/src/lib/visualExports";

const exportFixture: VisualCatalogExport = {
  profile: "VRA Core 4-aligned reviewed catalog export",
  exportedAt: "2026-08-27T00:00:00.000Z",
  projectId: 12,
  includeUnapproved: false,
  records: [{
    id: "123e4567-e89b-12d3-a456-426614174000",
    recordType: "image",
    title: "Courtyard, \"East\" wing",
    localIdentifier: "IMG-1",
    status: "approved",
    assetId: "123e4567-e89b-12d3-a456-426614174001",
    reviewedJson: {
      description: "A tiled courtyard & arcade",
      workType: ["architecture"],
      agents: ["Unknown architect"],
      dates: ["circa 1890"],
      locations: ["Cairo"],
      subjects: ["courtyards"],
      materials: ["tile", "stone"],
      techniques: ["photography"],
      inscriptions: ["بسم الله"],
      stylePeriod: ["Ottoman"],
    },
  }],
  relations: [],
};

describe("Visual Archives exports", () => {
  it("escapes reviewed catalog values in CSV output", () => {
    const csv = buildVisualCatalogCsv(exportFixture);
    expect(csv).toContain('"Courtyard, ""East"" wing"');
    expect(csv).toContain('"tile; stone"');
  });

  it("builds VRA Core 4-compatible wrapper, record types, identifiers, and reviewed field sets", () => {
    const xml = buildVraCoreXml(exportFixture);
    expect(xml).toContain('<vra xmlns="http://www.vraweb.org/vracore4.htm"');
    expect(xml).toContain('<image id="turath_123e4567_e89b_12d3_a456_426614174000" refid="IMG-1">');
    expect(xml).toContain("<titleSet><title>Courtyard, &quot;East&quot; wing</title></titleSet>");
    expect(xml).toContain("<locationSet><location><name>Cairo</name></location></locationSet>");
    expect(xml).toContain("<materialSet><material>tile</material><material>stone</material></materialSet>");
    expect(xml).not.toContain("aiSuggestedJson");
  });
});
