import { COOKIE_NAME, SESSION_DURATION_MS } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { getAppOrigin, getJwtSecret } from "./env";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const SESSION_ISSUER = "turath";
const SESSION_AUDIENCE = "turath-session";
const OAUTH_STATE_AUDIENCE = "google-oauth-state";
const OAUTH_TRANSACTION_AUDIENCE = "google-oauth-transaction";
const OAUTH_TRANSACTION_COOKIE = "turath_oauth_transaction";
const OAUTH_TRANSACTION_DURATION_MS = 10 * 60 * 1000;
const GOOGLE_REQUEST_TIMEOUT_MS = 15_000;

function getGoogleClientId(): string {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not configured");
  return clientId;
}

function getGoogleClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!secret) throw new Error("GOOGLE_CLIENT_SECRET is not configured");
  return secret;
}

export async function createSessionToken(
  openId: string,
  sessionStartedAt: Date
): Promise<string> {
  return new SignJWT({ openId, sessionVersion: sessionStartedAt.getTime() })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + SESSION_DURATION_MS) / 1000))
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
    const { openId, sessionVersion } = payload as Record<string, unknown>;
    if (typeof openId !== "string" || !openId) return null;
    if (
      typeof sessionVersion !== "number" ||
      !Number.isSafeInteger(sessionVersion)
    )
      return null;
    return { openId, sessionVersion };
  } catch {
    return null;
  }
}

type OAuthTransaction = {
  state: string;
  transactionCookie: string;
  codeChallenge: string;
};

export async function createOAuthTransaction(): Promise<OAuthTransaction> {
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const expiresAt = Math.floor(
    (Date.now() + OAUTH_TRANSACTION_DURATION_MS) / 1000
  );

  const state = await new SignJWT({ nonce })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(OAUTH_STATE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getJwtSecret());

  const transactionCookie = await new SignJWT({ nonce, codeVerifier })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(OAUTH_TRANSACTION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getJwtSecret());

  return { state, transactionCookie, codeChallenge };
}

function equalSecrets(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export async function verifyOAuthTransaction(
  stateToken: string,
  transactionToken: string
): Promise<{ codeVerifier: string } | null> {
  try {
    const secret = getJwtSecret();
    const [{ payload: state }, { payload: transaction }] = await Promise.all([
      jwtVerify(stateToken, secret, {
        algorithms: ["HS256"],
        issuer: SESSION_ISSUER,
        audience: OAUTH_STATE_AUDIENCE,
      }),
      jwtVerify(transactionToken, secret, {
        algorithms: ["HS256"],
        issuer: SESSION_ISSUER,
        audience: OAUTH_TRANSACTION_AUDIENCE,
      }),
    ]);

    if (
      typeof state.nonce !== "string" ||
      typeof transaction.nonce !== "string"
    )
      return null;
    if (!equalSecrets(state.nonce, transaction.nonce)) return null;
    if (
      typeof transaction.codeVerifier !== "string" ||
      transaction.codeVerifier.length < 43
    )
      return null;
    return { codeVerifier: transaction.codeVerifier };
  } catch {
    return null;
  }
}

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function getTransactionCookie(req: Request): string | undefined {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  return cookies[OAUTH_TRANSACTION_COOKIE];
}

function clearTransactionCookie(req: Request, res: Response) {
  res.clearCookie(OAUTH_TRANSACTION_COOKIE, {
    ...getSessionCookieOptions(req),
    path: "/api/auth/google/callback",
  });
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/auth/google", async (req: Request, res: Response) => {
    try {
      const redirectUri = `${getAppOrigin()}/api/auth/google/callback`;
      const transaction = await createOAuthTransaction();
      res.cookie(OAUTH_TRANSACTION_COOKIE, transaction.transactionCookie, {
        ...getSessionCookieOptions(req),
        path: "/api/auth/google/callback",
        maxAge: OAUTH_TRANSACTION_DURATION_MS,
      });

      const params = new URLSearchParams({
        client_id: getGoogleClientId(),
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        access_type: "offline",
        prompt: "consent",
        state: transaction.state,
        code_challenge: transaction.codeChallenge,
        code_challenge_method: "S256",
      });

      res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
    } catch (error) {
      console.error("[Google OAuth] Failed to start authorization:", error);
      res.status(503).json({ error: "OAuth is not configured" });
    }
  });

  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const stateParam = getQueryParam(req, "state");
    const transactionCookie = getTransactionCookie(req);
    clearTransactionCookie(req, res);

    if (getQueryParam(req, "error")) {
      res.status(400).json({ error: "Authorization was declined" });
      return;
    }
    if (!code || !stateParam || !transactionCookie) {
      res.status(400).json({ error: "Invalid OAuth callback" });
      return;
    }

    const transaction = await verifyOAuthTransaction(
      stateParam,
      transactionCookie
    );
    if (!transaction) {
      res.status(400).json({ error: "Invalid or expired OAuth state" });
      return;
    }

    const redirectUri = `${getAppOrigin()}/api/auth/google/callback`;

    try {
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: getGoogleClientId(),
          client_secret: getGoogleClientSecret(),
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: transaction.codeVerifier,
        }),
        signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
      });

      if (!tokenRes.ok) {
        const errBody = (await tokenRes.text()).slice(0, 500);
        console.error("[Google OAuth] Token exchange failed:", errBody);
        res.status(502).json({ error: "Token exchange failed" });
        return;
      }

      const tokenData = (await tokenRes.json()) as { access_token?: string };
      if (!tokenData.access_token) {
        res
          .status(502)
          .json({ error: "OAuth provider returned an invalid token response" });
        return;
      }

      const userRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
      });

      if (!userRes.ok) {
        console.error("[Google OAuth] User info fetch failed");
        res.status(502).json({ error: "Failed to fetch user info" });
        return;
      }

      const googleUser = (await userRes.json()) as {
        id?: string;
        email?: string;
        verified_email?: boolean;
        name?: string;
      };

      if (!googleUser.id) {
        res.status(400).json({ error: "Google user ID missing" });
        return;
      }

      const openId = `google_${googleUser.id}`;
      const verifiedEmail = googleUser.verified_email
        ? googleUser.email
        : undefined;
      let effectiveOpenId = openId;
      if (verifiedEmail) {
        const existingUser = await db.getUserByEmail(verifiedEmail);
        if (existingUser && existingUser.openId !== openId) {
          await db.updateUserOpenId(existingUser.openId, openId);
          effectiveOpenId = openId;
        }
      }

      const signedInAt = new Date();
      await db.upsertUser({
        openId: effectiveOpenId,
        name: googleUser.name || null,
        email: verifiedEmail,
        loginMethod: "google",
        lastSignedIn: signedInAt,
      });

      if (verifiedEmail) {
        const email = verifiedEmail;
        setImmediate(async () => {
          try {
            const { getPendingInvitesByEmail, acceptInvite } = await import(
              "../db"
            );
            const user = await db.getUserByOpenId(effectiveOpenId);
            if (user) {
              const pendingInvites = await getPendingInvitesByEmail(email);
              for (const invite of pendingInvites) {
                try {
                  await acceptInvite(invite.id, user.id, email);
                } catch (e) {
                  console.warn(
                    `[OAuth] Failed to auto-accept invite ${invite.id}:`,
                    e
                  );
                }
              }
            }
          } catch (error) {
            console.warn("[OAuth] Failed to auto-accept invites:", error);
          }
        });
      }

      const sessionToken = await createSessionToken(
        effectiveOpenId,
        signedInAt
      );
      res.cookie(COOKIE_NAME, sessionToken, {
        ...getSessionCookieOptions(req),
        maxAge: SESSION_DURATION_MS,
      });
      res.redirect(302, "/dashboard");
    } catch (error) {
      console.error("[Google OAuth] Callback failed:", error);
      res.status(502).json({ error: "OAuth callback failed" });
    }
  });
}
