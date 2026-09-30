import { Module } from '@nestjs/common';

import { ReportQueryService } from './report-query.service.js';
import { ReportRenderer } from './report-renderer.service.js';

/**
 * Requires the platform to bind `REVIEW_REPOSITORY` (see reviews/README.md);
 * the token must be visible to this module, e.g. via a `@Global()` module.
 */
@Module({
  providers: [ReportRenderer, ReportQueryService],
  exports: [ReportRenderer, ReportQueryService],
})
export class ReportsModule {}
