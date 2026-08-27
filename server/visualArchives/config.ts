import { ENV } from "../_core/env";

export function isVisualArchivesEnabled(): boolean {
  return ENV.visualArchivesEnabled;
}

/** Vector-backed semantic visual memory remains unavailable until its migration is applied and this flag is explicitly enabled. */
export function isVisualArchivesMemoryEnabled(): boolean {
  return ENV.visualArchivesEnabled && ENV.visualArchivesMemoryEnabled;
}

const VISUAL_ARCHIVES_PREVIEW_EMAILS = new Set([
  "adamamin2027@gmail.com",
]);

/** Server-side allowlist for the controlled Visual Archives development preview. */
export function isVisualArchivesPreviewUser(user: { email?: string | null } | null | undefined): boolean {
  const email = user?.email?.trim().toLowerCase();
  return Boolean(email && VISUAL_ARCHIVES_PREVIEW_EMAILS.has(email));
}
