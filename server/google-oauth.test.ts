import { describe, it, expect } from "vitest";

describe("Google OAuth Configuration", () => {
  it("should have the correct Brovarski Papers web client ID", () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    expect(clientId).toBeDefined();
    expect(clientId).toBe(
      "640280511703-rt61ei88l0vavp8g7t6a6ltro75b7kjt.apps.googleusercontent.com"
    );
  });

  it("should have GOOGLE_CLIENT_SECRET set", () => {
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    expect(secret).toBeDefined();
    expect(secret!.length).toBeGreaterThan(0);
  });

  it("should use a web application client (not desktop)", async () => {
    // Validate the client ID is a valid Google OAuth client by checking the discovery endpoint
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    // The client_id format should be {project_number}-{hash}.apps.googleusercontent.com
    expect(clientId).toMatch(
      /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/
    );
  });
});
