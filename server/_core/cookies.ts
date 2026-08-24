import type { CookieOptions, Request } from "express";

function isSecureRequest(req: Request) {
  // Express only derives req.secure from forwarded headers when the application
  // has explicitly enabled trust proxy for a known number of hops.
  return (
    process.env.NODE_ENV === "production" ||
    req.secure === true ||
    req.protocol === "https"
  );
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: isSecureRequest(req),
  };
}
