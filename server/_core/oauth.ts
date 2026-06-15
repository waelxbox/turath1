import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";

// ─── Google OAuth Configuration ──────────────────────────────────────────────────

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

function getGoogleClientId(): string {
  return process.env.GOOGLE_CLIENT_ID ?? "";
}

function getGoogleClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET ?? "";
}

// ─── JWT Session Helpers ─────────────────────────────────────────────────────

const JWT_SECRET = new TextEncoder().encode(ENV.cookieSecret || "turath-fallback-secret");

async function createSessionToken(openId: string, name: string): Promise<string> {
  return new SignJWT({ openId, name, appId: ENV.appId || "turath" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("365d")
    .sign(JWT_SECRET);
}

export async function verifySessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ["HS256"] });
    const { openId, name } = payload as Record<string, unknown>;
    if (typeof openId !== "string" || !openId) return null;
    return { openId, name: (name as string) || "" };
  } catch {
    return null;
  }
}

// ─── Route Handlers ────────────────────────────────────────────────────────

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  // Step 1: Redirect user to Google consent screen
  app.get("/api/auth/google", (req: Request, res: Response) => {
    const origin = getQueryParam(req, "origin") || `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${origin}/api/auth/google/callback`;
    const state = Buffer.from(JSON.stringify({ origin })).toString("base64url");

    const params = new URLSearchParams({
      client_id: getGoogleClientId(),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "consent",
      state,
    });

    res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  // Step 2: Google redirects back with an authorization code
  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const stateParam = getQueryParam(req, "state");

    if (!code) {
      res.status(400).json({ error: "Authorization code is required" });
      return;
    }

    // Parse origin from state
    let origin = `${req.protocol}://${req.get("host")}`;
    if (stateParam) {
      try {
        const parsed = JSON.parse(Buffer.from(stateParam, "base64url").toString());
        if (parsed.origin) origin = parsed.origin;
      } catch { /* use default origin */ }
    }

    const redirectUri = `${origin}/api/auth/google/callback`;

    try {
      // Exchange code for tokens
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: getGoogleClientId(),
          client_secret: getGoogleClientSecret(),
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        console.error("[Google OAuth] Token exchange failed:", errBody);
        res.status(500).json({ error: "Token exchange failed" });
        return;
      }

      const tokenData = (await tokenRes.json()) as { access_token: string; id_token?: string };

      // Fetch user profile
      const userRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (!userRes.ok) {
        console.error("[Google OAuth] User info fetch failed");
        res.status(500).json({ error: "Failed to fetch user info" });
        return;
      }

      const googleUser = (await userRes.json()) as {
        id: string;
        email: string;
        name: string;
        picture?: string;
      };

      if (!googleUser.id) {
        res.status(400).json({ error: "Google user ID missing" });
        return;
      }

      // Use Google ID as the openId for our system
      const openId = `google_${googleUser.id}`;

      await db.upsertUser({
        openId,
        name: googleUser.name || null,
        email: googleUser.email || null,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });

      // Auto-accept any pending invites for this user's email
      if (googleUser.email) {
        try {
          const { getPendingInvitesByEmail, acceptInvite } = await import("../db");
          const user = await db.getUserByOpenId(openId);
          if (user) {
            const pendingInvites = await getPendingInvitesByEmail(googleUser.email);
            for (const invite of pendingInvites) {
              try {
                await acceptInvite(invite.id, user.id);
              } catch (e) {
                console.warn(`[OAuth] Failed to auto-accept invite ${invite.id}:`, e);
              }
            }
          }
        } catch (e) {
          console.warn("[OAuth] Failed to auto-accept invites:", e);
        }
      }

      // Create our own JWT session token
      const sessionToken = await createSessionToken(openId, googleUser.name || "");

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // Redirect to dashboard after login
      res.redirect(302, "/dashboard");
    } catch (error) {
      console.error("[Google OAuth] Callback failed:", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
