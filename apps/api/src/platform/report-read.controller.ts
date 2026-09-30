import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { ReportQueryService } from '../reports/report-query.service.js';

/** Additive HTTP adapter using the unchanged engine read side and VerifiedReport contract. */
@Controller('api/reviews')
export class ReportReadController {
  constructor(
    @Inject(ReportQueryService) private readonly reports: ReportQueryService,
  ) {}
  @Get(':reviewId/report')
  async get(@Param('reviewId') id: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new NotFoundException('No report is available for this review.');
    const report = await this.reports.getReport(id);
    if (!report)
      throw new NotFoundException('No report is available for this review.');
    return report;
  }
}
