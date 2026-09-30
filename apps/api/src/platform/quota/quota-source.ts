import type {
  ProviderId,
  QuotaReason,
  QuotaStatus,
  QuotaWindow,
} from '@pr-orchestrator/contracts';

export interface QuotaMeasurement {
  status: Exclude<QuotaStatus, 'stale'>;
  reason: QuotaReason | null;
  windows: QuotaWindow[];
}
export interface QuotaSource {
  provider: ProviderId;
  read(signal: AbortSignal): Promise<QuotaMeasurement>;
}
export function unavailable(reason: QuotaReason): QuotaMeasurement {
  return { status: 'unavailable', reason, windows: [] };
}
