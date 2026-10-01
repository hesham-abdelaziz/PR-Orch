import { Injectable, inject } from '@angular/core';
import { VerifiedReportSchema } from '@pr-orchestrator/contracts';
import { ApiClientService } from '../../core/api/api-client.service';
import { VerifiedReportWithCoverage } from './review-coverage.model';

/**
 * Typed integration adapter for structured report retrieval.
 *
 * NOTE FOR CODEX:
 * `GET /api/reviews/:reviewId/report` is absent from the locked master API contract
 * and Claude's current ReviewsController (which only implements `GET :reviewId/report.md`).
 *
 * This adapter isolates the unresolved structured-report endpoint access and ensures
 * runtime response validation with `VerifiedReportSchema`. Once Codex resolves the contract
 * (e.g. adding the endpoint or embedding `VerifiedReport` in the job response envelope),
 * only this adapter needs to be wired to the finalized mechanism.
 */
@Injectable({ providedIn: 'root' })
export class ReportIntegrationService {
  private readonly apiClient = inject(ApiClientService);

  async getStructuredReport(reviewId: string): Promise<VerifiedReportWithCoverage> {
    return this.apiClient.request<VerifiedReportWithCoverage>({
      method: 'GET',
      path: `/api/reviews/${reviewId}/report`,
      schema: VerifiedReportSchema.passthrough(),
    });
  }
}
