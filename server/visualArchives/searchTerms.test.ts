import { describe, expect, it } from "vitest";
import { canonicalVisualSearchText, normalizeVisualSearchText, visualQueryTerms } from "./searchTerms";

describe("Visual Archives query normalization", () => {
  it("removes conversational filler while keeping the visual evidence terms", () => {
    expect(visualQueryTerms("street scenes with balconies and tram lines"))
      .toEqual(["street", "scene", "balcony", "tram", "line"]);
  });

  it("maps common archive language to VRA field names", () => {
    expect(visualQueryTerms("What places and photographers appear in this collection?"))
      .toEqual(["locations", "agents", "collection"]);
  });

  it("normalizes diacritics and camel-cased VRA fields consistently", () => {
    expect(normalizeVisualSearchText("Café culturalContext stylePeriod"))
      .toBe("cafe cultural context style period");
  });

  it("makes singular and plural visual terms searchable in either form", () => {
    expect(canonicalVisualSearchText("Balconies and tram lines")).toContain("balcony tram line");
  });
});
