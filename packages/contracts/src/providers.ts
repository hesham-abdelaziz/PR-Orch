import { z } from 'zod';

export const ProviderIdSchema = z.enum(['claude', 'codex', 'gemini']);

export const PROVIDER_ORDER = ['codex', 'claude', 'gemini'] as const;

export const PROVIDER_DISPLAY_NAMES: Record<ProviderId, string> = {
  codex: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
};

export const REASONING_EFFORT_VALUES = [
  'default',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export const ReasoningEffortSchema = z.enum(REASONING_EFFORT_VALUES);

export const ModelSelectionSchema = z.strictObject({
  provider: ProviderIdSchema,
  model: z.string().trim().min(1).max(200),
  reasoningEffort: ReasoningEffortSchema.optional(),
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
  supportedReasoningEfforts: z.array(ReasoningEffortSchema).optional(),
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
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;
export type AuthenticationState = z.infer<
  typeof AuthenticationStateSchema
>;
export type ModelCatalogEntry = z.infer<typeof ModelCatalogEntrySchema>;
export type ModelCatalog = z.infer<typeof ModelCatalogSchema>;
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export function getSupportedReasoningEfforts(
  modelEntry?: Pick<ModelCatalogEntry, 'supportedReasoningEfforts'> | null,
): readonly ReasoningEffort[] {
  if (!modelEntry?.supportedReasoningEfforts || modelEntry.supportedReasoningEfforts.length === 0) {
    return ['default'];
  }
  return modelEntry.supportedReasoningEfforts.includes('default')
    ? modelEntry.supportedReasoningEfforts
    : ['default', ...modelEntry.supportedReasoningEfforts];
}

export function isReasoningEffortSupported(
  modelEntry: Pick<ModelCatalogEntry, 'supportedReasoningEfforts'> | null | undefined,
  effort?: ReasoningEffort,
): boolean {
  if (!effort || effort === 'default') {
    return true;
  }
  const supported = modelEntry?.supportedReasoningEfforts;
  if (!supported || supported.length === 0) {
    return false;
  }
  return supported.includes(effort);
}

export function assertModelSelectionSupported(
  selection: ModelSelection,
  catalogModels: readonly ModelCatalogEntry[],
): void {
  const model = catalogModels.find((m) => m.id === selection.model);
  if (!model) {
    throw new Error(`Model "${selection.model}" is not offered by ${selection.provider}.`);
  }
  if (!model.available) {
    throw new Error(`Model "${selection.model}" is unavailable: ${model.unavailableReason ?? 'disabled'}.`);
  }
  if (!isReasoningEffortSupported(model, selection.reasoningEffort)) {
    throw new Error(
      `Reasoning effort "${selection.reasoningEffort}" is not supported by model "${selection.model}". Supported levels: ${getSupportedReasoningEfforts(model).join(', ')}.`,
    );
  }
}
