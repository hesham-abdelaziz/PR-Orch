import { Module } from '@nestjs/common';

import { RunLivenessService } from '../reviews/run-liveness.service.js';
import { ReportQueryService } from './report-query.service.js';
import { ReportRenderer } from './report-renderer.service.js';

/**
 * Requires the platform to bind `REVIEW_REPOSITORY` (see reviews/README.md);
 * the token must be visible to this module, e.g. via a `@Global()` module.
 */
@Module({
  // RunLivenessService is shared with the orchestrator (ReviewsModule imports this module).
  providers: [ReportRenderer, ReportQueryService, RunLivenessService],
  exports: [ReportRenderer, ReportQueryService, RunLivenessService],
})
export class ReportsModule {}
