import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildVisualAssetKey, createVisualDerivatives } from "./storage";

describe("Visual Archives image processing", () => {
  it("creates bounded JPEG display and thumbnail derivatives while preserving original metadata", async () => {
    const source = await sharp({
      create: {
        width: 2400,
        height: 1600,
        channels: 3,
        background: { r: 137, g: 103, b: 64 },
      },
    }).png().toBuffer();

    const derivatives = await createVisualDerivatives(source);

    expect(derivatives.width).toBe(2400);
    expect(derivatives.height).toBe(1600);
    expect(derivatives.format).toBe("png");
    expect(derivatives.displayMimeType).toBe("image/jpeg");
    expect(derivatives.display.length).toBeGreaterThan(0);
    expect(derivatives.thumbnail.length).toBeGreaterThan(0);

    const displayMetadata = await sharp(derivatives.display).metadata();
    const thumbnailMetadata = await sharp(derivatives.thumbnail).metadata();
    expect(displayMetadata.width).toBeLessThanOrEqual(2200);
    expect(thumbnailMetadata.width).toBeLessThanOrEqual(640);
    expect(displayMetadata.format).toBe("jpeg");
    expect(thumbnailMetadata.format).toBe("jpeg");
  });

  it("uses UUID-scoped project keys instead of user filenames", () => {
    const assetId = "123e4567-e89b-12d3-a456-426614174000";
    expect(buildVisualAssetKey(12, assetId, "original", "image/png"))
      .toBe(`projects/12/visual-assets/${assetId}/original.png`);
    expect(buildVisualAssetKey(12, assetId, "thumbnail", "image/jpeg"))
      .toBe(`projects/12/visual-assets/${assetId}/thumbnail.jpg`);
  });
});
