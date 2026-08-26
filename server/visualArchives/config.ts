import { ENV } from "../_core/env";

export function isVisualArchivesEnabled(): boolean {
  return ENV.visualArchivesEnabled;
}
