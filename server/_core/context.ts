import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME } from "@shared/const";
import { verifySessionToken } from "./oauth";
import * as db from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

function parseCookies(cookieHeader?: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!cookieHeader) return map;
  for (const pair of cookieHeader.split(";")) {
    const [key, ...rest] = pair.split("=");
    if (key) map.set(key.trim(), rest.join("=").trim());
  }
  return map;
}

/**
 * Authenticate an Express request using the same session rules as tRPC.
 * Non-tRPC routes (for example protected storage downloads) must use this
 * rather than interpreting the session cookie independently.
 */
export async function authenticateRequestUser(
  req: Pick<CreateExpressContextOptions["req"], "headers">
): Promise<User | null> {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    if (!sessionCookie) return null;

    const session = await verifySessionToken(sessionCookie);
    if (!session) return null;

    // Keep the retry small and fail closed. A database outage must never turn
    // a protected object into a public one.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const dbUser = (await db.getUserByOpenId(session.openId)) ?? null;
        // lastSignedIn acts as a lightweight session version. A new login or
        // explicit logout advances it and invalidates previously issued JWTs.
        if (
          dbUser &&
          dbUser.lastSignedIn.getTime() === session.sessionVersion
        ) {
          return dbUser;
        }
        return null;
      } catch (dbErr: any) {
        const isPoolExhausted =
          dbErr?.message?.includes("ECHECKOUTTIMEOUT") ||
          dbErr?.message?.includes("pool") ||
          dbErr?.message?.includes("timeout");
        if (isPoolExhausted && attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        console.warn(
          "[Context] DB lookup failed:",
          dbErr?.message?.slice(0, 100)
        );
        return null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const user = await authenticateRequestUser(opts.req);

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
