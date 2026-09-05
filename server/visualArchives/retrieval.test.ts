import { describe, expect, it } from "vitest";
import { dateRange, isContextualQuestion, rankCatalog, selectEvidence } from "./retrieval";
import { nextReviewRecord } from "../../shared/visualReviewQueue";

const records = [
  { id: "a", title: "Cairo streetcar", reviewedJson: { dates: ["1940"], locations: ["Cairo"], subjects: ["balcony"] } },
  { id: "b", title: "Courtyard", reviewedJson: { dates: ["1960"], materials: ["stone"] } },
  { id: "c", title: "Undated print", reviewedJson: { materials: [] } },
];
describe("visual retrieval", () => {
  it("finds partial and synonym matches without requiring every word", () => {
    expect(rankCatalog(records, "tram lines and balconies")[0].record.id).toBe("a");
  });
  it("filters reviewed dates and excludes unknown dates", () => {
    expect(dateRange("between 1935 and 1955")).toEqual([1935, 1955]);
    expect(rankCatalog(records, "between 1935 and 1955").map(item => item.record.id)).toEqual(["a"]);
    expect(rankCatalog(records, "", [1950, 1970]).map(item => item.record.id)).toEqual(["b"]);
  });
  it("does not rank empty field names as evidence", () => {
    expect(rankCatalog(records, "What materials recur in this collection?").map(item => item.record.id)).toEqual(["b"]);
    expect(rankCatalog(records, "glacier")).toEqual([]);
  });
  it("keeps follow-up anchors and only authorized approved related records", () => {
    expect(isContextualQuestion("Compare those with the other images")).toBe(true);
    const relations = [{ sourceRecordId: "a", targetRecordId: "b" }, { sourceRecordId: "a", targetRecordId: "private" }];
    expect(selectEvidence([], records, ["a", "private"], relations, true).map(record => record.id)).toEqual(["a", "b"]);
    expect(selectEvidence([], records, ["a"], relations, false)).toEqual([]);
  });
});
describe("review queue", () => {
  const queue = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("advances in order and skips records already approved elsewhere", () => {
    expect(nextReviewRecord(queue, "b", [queue[0], queue[2]])).toBe("c");
    expect(nextReviewRecord(queue, "a", [queue[2]])).toBe("c");
  });
  it("wraps at the end and never returns the current completed item", () => {
    expect(nextReviewRecord(queue, "c", [queue[0]])).toBe("a");
    expect(nextReviewRecord(queue, "a", [queue[0]])).toBeUndefined();
    expect(nextReviewRecord(queue, "c", [])).toBeUndefined();
  });
});
