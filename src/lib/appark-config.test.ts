import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_APPARK_SAMPLE_RATE,
  parseApparkSampleRate,
  shouldSampleApparkEvent,
} from "./appark-config";

describe("parseApparkSampleRate()", () => {
  it("defaults to 100% when the variable is absent or blank", () => {
    expect(parseApparkSampleRate(undefined)).toEqual({
      rate: DEFAULT_APPARK_SAMPLE_RATE,
      configured: false,
      valid: true,
    });
    expect(parseApparkSampleRate("   ")).toEqual({
      rate: DEFAULT_APPARK_SAMPLE_RATE,
      configured: false,
      valid: true,
    });
  });

  it("parses the inclusive zero-to-one range", () => {
    expect(parseApparkSampleRate("0")).toEqual({ rate: 0, configured: true, valid: true });
    expect(parseApparkSampleRate("0.25")).toEqual({ rate: 0.25, configured: true, valid: true });
    expect(parseApparkSampleRate("1")).toEqual({ rate: 1, configured: true, valid: true });
  });

  it("fails open for non-numeric and out-of-range values", () => {
    for (const raw of ["nope", "-0.1", "1.1", "Infinity", "NaN"]) {
      expect(parseApparkSampleRate(raw)).toEqual({
        rate: DEFAULT_APPARK_SAMPLE_RATE,
        configured: true,
        valid: false,
      });
    }
  });
});

describe("shouldSampleApparkEvent()", () => {
  it("always samples at 1 and never samples at 0 without consuming randomness", () => {
    const random = vi.fn(() => 0);
    expect(shouldSampleApparkEvent(1, random)).toBe(true);
    expect(shouldSampleApparkEvent(0, random)).toBe(false);
    expect(random).not.toHaveBeenCalled();
  });

  it("uses the configured probability for fractional rates", () => {
    expect(shouldSampleApparkEvent(0.25, () => 0.249)).toBe(true);
    expect(shouldSampleApparkEvent(0.25, () => 0.25)).toBe(false);
    expect(shouldSampleApparkEvent(0.25, () => 0.999)).toBe(false);
  });
});
