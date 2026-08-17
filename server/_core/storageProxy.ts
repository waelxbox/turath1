import type { Express } from "express";
import { ENV } from "./env";

export function registerStorageProxy(app: Express) {
  // Dedicated hero image endpoint that bypasses the platform's /manus-storage/ edge interception
  app.get("/api/hero-image", async (_req, res) => {
    const key = "manuscript-hero_a377d6f4.jpg";
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });
      if (!forgeResp.ok) {
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL");
        return;
      }
      const imageResp = await fetch(url);
      if (!imageResp.ok) {
        res.status(502).send("Failed to fetch image");
        return;
      }
      const contentType = imageResp.headers.get("content-type") || "image/jpeg";
      res.set("Content-Type", contentType);
      res.set("Cache-Control", "public, max-age=86400, immutable");
      const buffer = Buffer.from(await imageResp.arrayBuffer());
      res.send(buffer);
    } catch (err) {
      console.error("[HeroImage] failed:", err);
      res.status(502).send("Image proxy error");
    }
  });

  app.get("/manus-storage/*", async (req, res) => {
    const key = req.path.replace("/manus-storage/", "");
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      // Stream the image bytes directly instead of redirecting
      // This avoids signed URL expiration and cross-origin redirect issues on production
      const imageResp = await fetch(url);
      if (!imageResp.ok) {
        console.error(`[StorageProxy] image fetch error: ${imageResp.status}`);
        res.status(502).send("Failed to fetch image from storage");
        return;
      }
      const contentType = imageResp.headers.get("content-type") || "application/octet-stream";
      res.set("Content-Type", contentType);
      res.set("Cache-Control", "public, max-age=86400");
      const buffer = Buffer.from(await imageResp.arrayBuffer());
      res.send(buffer);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
