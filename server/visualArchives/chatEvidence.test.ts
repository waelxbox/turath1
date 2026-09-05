import { describe, expect, it } from "vitest";
import { validateEvidenceLinkedAnswer } from "./chatEvidence";

describe("Visual Archive answer evidence validation", () => {
  it("keeps a cited answer and returns only the cited records", () => {
    expect(validateEvidenceLinkedAnswer("Stone appears in the courtyard. [Record 2]", [1, 2, 3]))
      .toEqual({
        answer: "Stone appears in the courtyard. [Record 2]",
        citedIndices: [2],
        insufficientEvidence: false,
      });
  });

  it("fails closed when the model omits citations or invents a record number", () => {
    expect(validateEvidenceLinkedAnswer("Stone is visible. [Record 1]\n\nThis is the oldest building in Egypt.", [1]).insufficientEvidence).toBe(true);
    expect(validateEvidenceLinkedAnswer("The image shows a courtyard.", [1]).insufficientEvidence).toBe(true);
    expect(validateEvidenceLinkedAnswer("The image shows a courtyard. [Record 99]", [1]).insufficientEvidence).toBe(true);
  });
});
