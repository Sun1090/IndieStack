/**
 * Appark APM sampling configuration (E01).
 *
 * The parser is intentionally pure so runtime code and environment diagnostics
 * share exactly the same interpretation. An unset rate keeps the historical
 * 100% sampling behaviour; malformed values fail open so a typo cannot silently
 * turn off telemetry.
 */

export const APPARK_SAMPLE_RATE_KEY = "NEXT_PUBLIC_APPARK_SAMPLE_RATE";

export const DEFAULT_APPARK_SAMPLE_RATE = 1;

export interface ApparkSampleRateConfig {
  /** Effective rate in the inclusive range [0, 1]. */
  rate: number;
  /** Whether the environment variable was present (even when invalid). */
  configured: boolean;
  /** Whether the configured value is a finite number in [0, 1]. */
  valid: boolean;
}

/** Parse a configured sample rate and fail open to 100% for invalid values. */
export function parseApparkSampleRate(raw: string | undefined): ApparkSampleRateConfig {
  if (raw === undefined || raw.trim() === "") {
    return { rate: DEFAULT_APPARK_SAMPLE_RATE, configured: false, valid: true };
  }

  const rate = Number(raw.trim());
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    return { rate: DEFAULT_APPARK_SAMPLE_RATE, configured: true, valid: false };
  }

  return { rate, configured: true, valid: true };
}

/** Decide whether one event should be queued. */
export function shouldSampleApparkEvent(
  rate: number,
  random: () => number = Math.random,
): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return random() < rate;
}
