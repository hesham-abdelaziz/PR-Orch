import type { QuotaWindow } from '@pr-orchestrator/contracts';
import { unavailable, type QuotaMeasurement } from './quota-source.js';

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
export function remainingPercent(used: unknown): number | null {
  return typeof used === 'number' &&
    Number.isFinite(used) &&
    used >= 0 &&
    used <= 100
    ? 100 - used
    : null;
}
function duration(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 525600
    ? value
    : null;
}
function reset(value: unknown): string | null {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 253402300799
  )
    return null;
  return new Date(value * 1000).toISOString();
}
/** Projects only quota numbers: never pass through upstream IDs, names, credits,
 * plan, account fields or raw errors. Multi-pool view supersedes legacy view. */
export function normalizeCodexQuota(raw: unknown): QuotaMeasurement {
  const result = record(raw);
  if (!result) return { status: 'error', reason: 'invalid_data', windows: [] };
  const multi = record(result.rateLimitsByLimitId);
  const pools: [string, unknown][] = multi
    ? Object.entries(multi)
    : result.rateLimitsByLimitId != null
      ? []
      : [['codex', result.rateLimits]];
  if (pools.length > 16)
    return { status: 'error', reason: 'invalid_data', windows: [] };
  const windows: QuotaWindow[] = [];
  let index = 0;
  for (const [id, rawPool] of pools) {
    index++;
    const pool = record(rawPool);
    if (!pool) continue;
    for (const window of ['primary', 'secondary'] as const) {
      const value = record(pool[window]);
      if (!value) continue;
      windows.push({
        poolId: id === 'codex' ? 'codex' : `pool-${index}`,
        window,
        scope: 'shared_pool',
        model: null,
        remainingPercent: remainingPercent(value.usedPercent),
        windowDurationMins: duration(value.windowDurationMins),
        resetAt: reset(value.resetsAt),
      });
    }
  }
  if (!windows.length) return unavailable('no_measurement');
  return {
    status: windows.some((w) => w.remainingPercent !== null)
      ? 'available'
      : 'unavailable',
    reason: windows.every((w) => w.remainingPercent === null)
      ? 'no_measurement'
      : null,
    windows,
  };
}
