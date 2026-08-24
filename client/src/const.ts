export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// The server owns the canonical OAuth redirect URI. Never let browser-controlled
// origin data influence it.
export const getLoginUrl = () => "/api/auth/google";
