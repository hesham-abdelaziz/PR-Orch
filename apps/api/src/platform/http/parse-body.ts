import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';
/** Schema errors expose neither supplied values nor credential-bearing diagnostics. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException('Invalid request body');
  return result.data;
}
