/** The dashboard has its own allowlist; general admin roles do not grant access. */
export const PLATFORM_OWNER_EMAIL = "adamamin2027@gmail.com";

export function isPlatformOwner(email?: string | null): boolean {
  return email?.trim().toLowerCase() === PLATFORM_OWNER_EMAIL;
}

export type CostRates = {
  transcription: number | null;
  visualAsset: number | null;
  storageGbMonth: number | null;
};
export type CostWorkload = {
  transcriptions: number;
  assets: number;
  bytes: number;
};

/** Planning assumptions, not token metering or a provider invoice. */
export function estimateCost(work: CostWorkload, rates: CostRates) {
  const valid = (rate: number | null) =>
    rate !== null && Number.isFinite(rate) && rate >= 0;
  return {
    processing:
      valid(rates.transcription) && valid(rates.visualAsset)
        ? work.transcriptions * rates.transcription! +
          work.assets * rates.visualAsset!
        : null,
    storageMonthly: valid(rates.storageGbMonth)
      ? (work.bytes / 1_000_000_000) * rates.storageGbMonth!
      : null,
  };
}
