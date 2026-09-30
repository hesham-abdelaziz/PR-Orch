import { describe, expect, it } from "vitest";
import { QuotaWindowSchema, ProviderQuotasResponseSchema } from "./quota.js";
describe("quota contract", () => {
  const window = {
    poolId: "codex",
    window: "primary",
    scope: "shared_pool",
    model: null,
    remainingPercent: null,
    windowDurationMins: null,
    resetAt: null,
  };
  it("distinguishes unknown from zero and bounds known percentages", () => {
    for (const remainingPercent of [null, 0, 100])
      expect(
        QuotaWindowSchema.safeParse({ ...window, remainingPercent }).success,
      ).toBe(true);
    for (const remainingPercent of [-1, 101, NaN, Infinity, "25"])
      expect(
        QuotaWindowSchema.safeParse({ ...window, remainingPercent }).success,
      ).toBe(false);
  });
  it("rejects per-model allocations, arbitrary identifiers and account details", () => {
    expect(
      QuotaWindowSchema.safeParse({ ...window, scope: "model", model: "gpt-6" })
        .success,
    ).toBe(false);
    expect(
      QuotaWindowSchema.safeParse({ ...window, poolId: "private@example.com" })
        .success,
    ).toBe(false);
    expect(
      QuotaWindowSchema.safeParse({ ...window, token: "private" }).success,
    ).toBe(false);
    expect(
      ProviderQuotasResponseSchema.safeParse({ providers: [] }).success,
    ).toBe(false);
  });
});
