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

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    const cookies = parseCookies(opts.req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    if (sessionCookie) {
      const session = await verifySessionToken(sessionCookie);
      if (session) {
        // Try to get user from DB with a short timeout
        // If DB is overloaded, we retry once before giving up
        let dbUser: User | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const result = await db.getUserByOpenId(session.openId);
            dbUser = result ?? null;
            break;
          } catch (dbErr: any) {
            const isPoolExhausted = dbErr?.message?.includes("ECHECKOUTTIMEOUT") ||
              dbErr?.message?.includes("pool") ||
              dbErr?.message?.includes("timeout");
            if (isPoolExhausted && attempt === 0) {
              // Wait briefly and retry once
              await new Promise(r => setTimeout(r, 500));
              continue;
            }
            // On second failure or non-pool error, log but don't crash
            console.warn("[Context] DB lookup failed:", dbErr?.message?.slice(0, 100));
            break;
          }
        }
        // lastSignedIn acts as a lightweight session version. A new login or
        // explicit logout advances it and invalidates previously issued JWTs.
        if (dbUser && dbUser.lastSignedIn.getTime() === session.sessionVersion) {
          user = dbUser;
        }
      }
    }
  } catch {
    // JWT verification failed or no cookie — genuinely not authenticated
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
