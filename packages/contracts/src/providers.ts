import { z } from 'zod';

export const ProviderIdSchema = z.enum(['claude', 'codex', 'gemini']);

export const ModelSelectionSchema = z.strictObject({
  provider: ProviderIdSchema,
  model: z.string().trim().min(1).max(200),
});

export const AuthenticationStateSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('authenticated') }),
  z.strictObject({
    state: z.literal('unauthenticated'),
    message: z.string().trim().min(1).max(500).optional(),
  }),
  z.strictObject({
    state: z.literal('unknown_until_run'),
    message: z.string().trim().min(1).max(500).optional(),
  }),
  z.strictObject({
    state: z.literal('error'),
    message: z.string().trim().min(1).max(500),
  }),
]);

export const ModelCatalogEntrySchema = z.strictObject({
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
  available: z.boolean(),
  unavailableReason: z.string().trim().min(1).max(500).optional(),
});

export const ModelCatalogSchema = z.strictObject({
  discovery: z.enum(['dynamic', 'maintained', 'configured']),
  models: z.array(ModelCatalogEntrySchema),
});

export const ProviderStatusSchema = z.strictObject({
  provider: ProviderIdSchema,
  installed: z.boolean(),
  executablePath: z.string().trim().min(1).max(1_024).optional(),
  version: z.string().trim().min(1).max(100).optional(),
  authentication: AuthenticationStateSchema,
  modelCatalog: ModelCatalogSchema,
  refreshedAt: z.string().datetime(),
});

export type ProviderId = z.infer<typeof ProviderIdSchema>;
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;
export type AuthenticationState = z.infer<
  typeof AuthenticationStateSchema
>;
export type ModelCatalog = z.infer<typeof ModelCatalogSchema>;
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
