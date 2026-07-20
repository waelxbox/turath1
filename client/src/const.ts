export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Generate Google OAuth login URL at runtime so redirect URI reflects the current origin.
export const getLoginUrl = () => {
  return `/api/auth/google?origin=${encodeURIComponent(window.location.origin)}`;
};
