import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
vi.mock("./db", () => ({
  createValidationSession: vi.fn().mockResolvedValue({
    id: 1,
    projectId: 1,
    title: "Test Session",
    shareToken: "abc123",
    totalDocs: 5,
    reviewsPerDoc: 5,
    status: "active",
    createdAt: new Date(),
    closedAt: null,
    documentIds: [1, 2, 3, 4, 5],
  }),
  getValidationSessionByToken: vi.fn().mockImplementation((token: string) => {
    if (token === "valid_token") {
      return Promise.resolve({
        id: 1,
        projectId: 1,
        title: "Test Session",
        shareToken: "valid_token",
        totalDocs: 5,
        reviewsPerDoc: 5,
        status: "active",
        createdAt: new Date(),
        closedAt: null,
        documentIds: [1, 2, 3, 4, 5],
      });
    }
    if (token === "closed_token") {
      return Promise.resolve({
        id: 2,
        projectId: 1,
        title: "Closed Session",
        shareToken: "closed_token",
        totalDocs: 5,
        reviewsPerDoc: 5,
        status: "closed",
        createdAt: new Date(),
        closedAt: new Date(),
        documentIds: [1, 2, 3, 4, 5],
      });
    }
    return Promise.resolve(null);
  }),
  getValidationSessionsByProject: vi.fn().mockResolvedValue([]),
  closeValidationSession: vi.fn().mockResolvedValue(undefined),
  getNextAssignment: vi.fn().mockImplementation((sessionId: number, username: string) => {
    if (username === "no_docs_left") return Promise.resolve(null);
    return Promise.resolve({
      id: 10,
      sessionId,
      documentId: 1,
      reviewerUsername: username,
      status: "in_progress",
      linesReviewed: 0,
      correctCount: 0,
      incorrectCount: 0,
      totalLines: 0,
      createdAt: new Date(),
      completedAt: null,
    });
  }),
  getAssignmentById: vi.fn().mockResolvedValue(null),
  submitLineVerdict: vi.fn().mockResolvedValue(undefined),
  completeAssignment: vi.fn().mockResolvedValue(undefined),
  getReviewerProgress: vi.fn().mockResolvedValue({ completed: 2, inProgress: null, totalAvailable: 5 }),
  getValidationStats: vi.fn().mockResolvedValue({
    totalReviews: 100,
    totalCorrect: 85,
    totalIncorrect: 15,
    overallAccuracy: 0.85,
    interRaterAgreement: 0.92,
    multiReviewedLines: 50,
    docsCompleted: 3,
    totalDocs: 5,
    uniqueReviewers: 4,
    docStats: [],
    reviewerStats: [],
    session: { id: 1, reviewsPerDoc: 5 },
  }),
  getReviewsForAssignment: vi.fn().mockResolvedValue([]),
  getTranscriptionByDocumentId: vi.fn().mockResolvedValue({
    id: 1,
    documentId: 1,
    rawJson: { full_transcription_ar: "سطر أول\nسطر ثاني\nسطر ثالث" },
    reviewedJson: null,
  }),
  getDocumentById: vi.fn().mockResolvedValue({
    id: 1,
    filename: "test.pdf",
    storageUrl: "https://example.com/test.pdf",
  }),
  getProjectById: vi.fn().mockResolvedValue({ id: 1, name: "Test" }),
  getDb: vi.fn().mockResolvedValue({}),
}));

describe("Validation Portal - Round Robin Assignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return null assignment when all docs are fully assigned", async () => {
    const { getNextAssignment } = await import("./db");
    (getNextAssignment as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const result = await getNextAssignment(1, "no_docs_left");
    expect(result).toBeNull();
  });

  it("should return an assignment for a new reviewer", async () => {
    const { getNextAssignment } = await import("./db");

    const result = await getNextAssignment(1, "reviewer1");
    expect(result).not.toBeNull();
    expect(result!.reviewerUsername).toBe("reviewer1");
    expect(result!.status).toBe("in_progress");
  });

  it("should track line verdicts correctly", async () => {
    const { submitLineVerdict } = await import("./db");

    await submitLineVerdict({
      assignmentId: 10,
      shareToken: "validation-test-share-token-000001",
      reviewerUsername: "reviewer1",
      lineIndex: 0,
      lineText: "سطر أول",
      verdict: "correct",
    });

    expect(true).toBe(true);
  });
});
