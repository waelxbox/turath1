export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  googleAiApiKey: process.env.GOOGLE_AI_API_KEY ?? "",
};

export type StartupConfig = {
  appOrigin: string;
  trustProxyHops: number;
};

function requireNonEmpty(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getJwtSecret(env: NodeJS.ProcessEnv = process.env): Uint8Array {
  const secret = requireNonEmpty(env, "JWT_SECRET");
  const bytes = new TextEncoder().encode(secret);
  if (bytes.byteLength < 32) {
    throw new Error("JWT_SECRET must be at least 32 bytes");
  }
  return bytes;
}

export function getAppOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.APP_ORIGIN?.trim();
  const rawOrigin =
    configured ||
    (env.NODE_ENV === "development" || env.NODE_ENV === "test"
      ? `http://localhost:${env.PORT || "3000"}`
      : "");

  if (!rawOrigin) {
    throw new Error("Missing required environment variable: APP_ORIGIN");
  }

  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new Error("APP_ORIGIN must be a valid absolute URL");
  }

  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "APP_ORIGIN must contain only a scheme, host, and optional port"
    );
  }
  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("APP_ORIGIN must use HTTPS in production");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("APP_ORIGIN must use HTTP or HTTPS");
  }

  return url.origin;
}

function getTrustProxyHops(env: NodeJS.ProcessEnv): number {
  const raw = env.TRUST_PROXY_HOPS?.trim() || "0";
  if (!/^\d+$/.test(raw)) {
    throw new Error("TRUST_PROXY_HOPS must be a non-negative integer");
  }
  const hops = Number(raw);
  if (!Number.isSafeInteger(hops) || hops > 10) {
    throw new Error("TRUST_PROXY_HOPS must be between 0 and 10");
  }
  return hops;
}

export function validateStartupEnv(
  env: NodeJS.ProcessEnv = process.env
): StartupConfig {
  getJwtSecret(env);
  requireNonEmpty(env, "GOOGLE_CLIENT_ID");
  requireNonEmpty(env, "GOOGLE_CLIENT_SECRET");

  return {
    appOrigin: getAppOrigin(env),
    trustProxyHops: getTrustProxyHops(env),
  };
}
