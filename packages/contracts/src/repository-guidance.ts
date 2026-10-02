import { z } from 'zod';

export const REPOSITORY_GUIDANCE_MAX_BYTES = 64 * 1024;

// JSON can contain unpaired UTF-16 surrogates; TextEncoder would silently replace
// them. Reject them before measuring UTF-8 so the stored text stays exact.
const invalidUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const filenameSchema = z.string().min(1)
  .refine(value => !invalidUnicode.test(value), 'Filename must contain valid Unicode')
  .refine(value => !/[\\/:\u0000-\u001F\u007F-\u009F]/.test(value) && !value.includes('..'), 'Filename must be a safe basename')
  .refine(value => /\.(md|txt)$/i.test(value), 'Guidance must be a .md or .txt file');
const contentSchema = z.string()
  .refine(value => value.trim().length > 0, 'Guidance content must not be empty')
  .refine(value => !invalidUnicode.test(value), 'Guidance must contain valid Unicode')
  // Permit the tab and line endings used in Markdown/plain text.
  .refine(value => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(value), 'Guidance contains control characters')
  .refine(value => new TextEncoder().encode(value).byteLength <= REPOSITORY_GUIDANCE_MAX_BYTES, 'Guidance exceeds 64 KiB of UTF-8');

/** Per-review request attachment. Content is preserved exactly, never truncated. */
export const RepositoryGuidanceSchema = z.strictObject({ filename: filenameSchema, content: contentSchema });

/** Public metadata only; strictness prevents accidentally serializing content. */
export const RepositoryGuidanceMetadataSchema = z.strictObject({
  filename: filenameSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().min(1).max(REPOSITORY_GUIDANCE_MAX_BYTES),
});

/** Internal immutable snapshot. The engine computes SHA-256 at creation. */
export const RepositoryGuidanceSnapshotSchema = RepositoryGuidanceMetadataSchema.extend({ content: contentSchema })
  .refine(value => new TextEncoder().encode(value.content).byteLength === value.sizeBytes, 'Guidance size does not match content');

export type RepositoryGuidance = z.infer<typeof RepositoryGuidanceSchema>;
export type RepositoryGuidanceMetadata = z.infer<typeof RepositoryGuidanceMetadataSchema>;
export type RepositoryGuidanceSnapshot = Readonly<z.infer<typeof RepositoryGuidanceSnapshotSchema>>;
