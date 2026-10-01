import { Injectable } from '@nestjs/common';

/**
 * Last process heartbeat per running run. Deliberately in memory only: a
 * heartbeat proves the provider process is alive *now*, so it means nothing
 * after a restart or once the run ended. Entries exist only while a run's
 * provider process is being supervised.
 */
@Injectable()
export class RunLivenessService {
  private readonly heartbeats = new Map<string, string>();

  beat(runId: string, at: string): void {
    this.heartbeats.set(runId, at);
  }

  lastHeartbeat(runId: string): string | null {
    return this.heartbeats.get(runId) ?? null;
  }

  clear(runId: string): void {
    this.heartbeats.delete(runId);
  }

  trackedRunCount(): number {
    return this.heartbeats.size;
  }
}
