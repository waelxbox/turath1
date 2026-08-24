import type { NextFunction, Request, Response } from "express";
import { getAppOrigin } from "./env";

function optionalOrigin(value: string | undefined): string | undefined {
  if (!value || value.includes("%")) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

export function getHelmetOptions(
  env: NodeJS.ProcessEnv = process.env,
  inlineScriptHashes: string[] = []
) {
  const isProduction = env.NODE_ENV === "production";
  const analyticsOrigin = optionalOrigin(env.VITE_ANALYTICS_ENDPOINT);
  const forgeOrigin = optionalOrigin(env.BUILT_IN_FORGE_API_URL);
  const externalScriptOrigins = [
    analyticsOrigin,
    forgeOrigin,
    "https://forge.butterfly-effect.dev",
  ].filter((origin): origin is string => Boolean(origin));
  const externalConnectOrigins = [
    ...externalScriptOrigins,
    "https://generativelanguage.googleapis.com",
  ];

  return {
    contentSecurityPolicy: isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            childSrc: ["'self'", "blob:"],
            connectSrc: ["'self'", ...externalConnectOrigins],
            fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            objectSrc: ["'none'"],
            scriptSrc: [
              "'self'",
              "'wasm-unsafe-eval'",
              ...externalScriptOrigins,
              ...inlineScriptHashes,
            ],
            scriptSrcAttr: ["'none'"],
            styleSrc: [
              "'self'",
              "'unsafe-inline'",
              "https://fonts.googleapis.com",
            ],
            workerSrc: ["'self'", "blob:"],
            upgradeInsecureRequests: [],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "no-referrer" },
    strictTransportSecurity: isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
  };
}

export function setAdditionalSecurityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(self), usb=()"
  );
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  next();
}

/** Reject browser requests that originate outside the configured application. */
export function requireTrustedOrigin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site")?.toLowerCase();
  const expectedOrigin = getAppOrigin();

  if ((origin && origin !== expectedOrigin) || fetchSite === "cross-site") {
    res.status(403).json({ error: "Untrusted request origin" });
    return;
  }

  next();
}
