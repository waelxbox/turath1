import { describe, expect, it } from "vitest";
import { acceptSuggestedFields, rejectSuggestedFields } from "./suggestionReview";

describe("Visual Archives suggestion review", () => {
  it("applies an entire suggestion batch once and records the reviewed fields", () => {
    const result = acceptSuggestedFields({
      title: "Untitled image",
      reviewedJson: { locations: ["Ahmedabad"] },
      suggestions: {
        title: "Sangath architectural study",
        workType: ["architectural complex"],
        materials: ["concrete", "brick"],
      },
      provenance: { model: "gemini" },
      acceptedFields: ["title", "workType", "materials"],
      userId: 7,
      reviewedAt: "2026-08-27T10:00:00.000Z",
    });

    expect(result.appliedFields).toEqual(["title", "workType", "materials"]);
    expect(result.title).toBe("Sangath architectural study");
    expect(result.reviewedJson).toEqual({
      locations: ["Ahmedabad"],
      workType: ["architectural complex"],
      materials: ["concrete", "brick"],
    });
    expect(result.suggestionProvenance).toMatchObject({
      model: "gemini",
      acceptedFields: ["title", "workType", "materials"],
      rejectedFields: [],
      lastReviewedByUserId: 7,
    });
  });

  it("is idempotent when an accepted field is submitted twice", () => {
    const result = acceptSuggestedFields({
      title: "Sangath",
      reviewedJson: { materials: ["concrete"] },
      suggestions: { materials: ["concrete"] },
      provenance: { acceptedFields: ["materials"] },
      acceptedFields: ["materials"],
      userId: 7,
      reviewedAt: "2026-08-27T10:00:00.000Z",
    });

    expect(result.appliedFields).toEqual([]);
    expect(result.suggestionProvenance.acceptedFields).toEqual(["materials"]);
  });

  it("moves a field out of rejected provenance when it is explicitly accepted", () => {
    const result = acceptSuggestedFields({
      title: "Sangath",
      reviewedJson: {},
      suggestions: { locations: ["Ahmedabad"] },
      provenance: { rejectedFields: ["locations", "materials"] },
      acceptedFields: ["locations"],
      userId: 7,
      reviewedAt: "2026-08-27T10:00:00.000Z",
    });

    expect(result.suggestionProvenance.acceptedFields).toEqual(["locations"]);
    expect(result.suggestionProvenance.rejectedFields).toEqual(["materials"]);
  });

  it("records rejection once and removes a conflicting accepted decision", () => {
    const first = rejectSuggestedFields({
      provenance: { acceptedFields: ["workType", "materials"] },
      rejectedFields: ["workType"],
      userId: 7,
      reviewedAt: "2026-08-27T10:00:00.000Z",
    });
    const duplicate = rejectSuggestedFields({
      provenance: first.suggestionProvenance,
      rejectedFields: ["workType"],
      userId: 7,
      reviewedAt: "2026-08-27T10:01:00.000Z",
    });

    expect(first.appliedFields).toEqual(["workType"]);
    expect(first.suggestionProvenance.acceptedFields).toEqual(["materials"]);
    expect(first.suggestionProvenance.rejectedFields).toEqual(["workType"]);
    expect(duplicate.appliedFields).toEqual([]);
  });
});
