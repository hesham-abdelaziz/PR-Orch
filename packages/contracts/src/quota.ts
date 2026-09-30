import { z } from "zod";
import { ProviderIdSchema } from "./providers.js";

export const QuotaStatusSchema = z.enum([
  "available",
  "unavailable",
  "unauthenticated",
  "error",
  "stale",
]);
export const QuotaReasonSchema = z.enum([
  "unsupported_source",
  "cli_missing",
  "login_required",
  "unsupported_auth",
  "source_error",
  "invalid_data",
  "no_measurement",
  "refresh_failed",
]);
// No runtime source currently verifies a model allocation. All exposed pools are
// shared within the provider account; model identity must therefore remain null.
export const QuotaWindowSchema = z.strictObject({
  poolId: z
    .string()
    .regex(/^(codex|pool-[1-9][0-9]*)$/)
    .max(32),
  window: z.enum(["primary", "secondary"]),
  scope: z.literal("shared_pool"),
  model: z.null(),
  remainingPercent: z.number().finite().min(0).max(100).nullable(),
  windowDurationMins: z.number().int().positive().max(525600).nullable(),
  resetAt: z.string().datetime().nullable(),
});
export const ProviderQuotaSchema = z.strictObject({
  provider: ProviderIdSchema,
  scope: z.literal("account"),
  status: QuotaStatusSchema,
  reason: QuotaReasonSchema.nullable(),
  source: z.enum(["codex_app_server", "none"]),
  message: z.string().max(300).nullable(),
  windows: z.array(QuotaWindowSchema).max(32),
  lastUpdatedAt: z.string().datetime().nullable(),
  checkedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export const ProviderQuotasResponseSchema = z.strictObject({
  providers: z.array(ProviderQuotaSchema).length(3),
  cacheTtlSeconds: z.literal(60),
  refreshCooldownSeconds: z.literal(15),
  nextRefreshAt: z.string().datetime(),
});
export type QuotaWindow = z.infer<typeof QuotaWindowSchema>;
export type QuotaStatus = z.infer<typeof QuotaStatusSchema>;
export type QuotaReason = z.infer<typeof QuotaReasonSchema>;
export type ProviderQuota = z.infer<typeof ProviderQuotaSchema>;
export type ProviderQuotasResponse = z.infer<
  typeof ProviderQuotasResponseSchema
>;
