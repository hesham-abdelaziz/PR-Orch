import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  Sse,
  UnprocessableEntityException,
  type MessageEvent,
} from '@nestjs/common';
import type { CreateReviewRequest, ReviewJob } from '@pr-orchestrator/contracts';
import { ZodError } from 'zod';
import { map, type Observable } from 'rxjs';

import { ProviderNotSelectableError } from '../providers/provider-registry.service.js';
import { redactSecrets } from '../providers/redact-secrets.js';
import {
  ReportQueryService,
  ReviewHistoryQuerySchema,
  type ReviewHistoryPage,
} from '../reports/report-query.service.js';
import { ActiveReviewExistsError, ReviewNotFoundError } from './review-errors.js';
import { ReviewEventsService } from './review-events.service.js';
import { ReviewOrchestratorService } from './review-orchestrator.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface HeaderResponse {
  setHeader(name: string, value: string): unknown;
}

function issuesOf(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues
    .slice(0, 20)
    .map((issue) => ({ path: issue.path.join('.'), message: redactSecrets(issue.message) }));
}

/**
 * Routes carry the full `api/` prefix from the locked HTTP contract, so the
 * application must not also set a global `api` prefix. Authentication is the
 * platform's global session guard.
 */
@Controller('api/reviews')
export class ReviewsController {
  constructor(
    @Inject(ReviewOrchestratorService) private readonly orchestrator: ReviewOrchestratorService,
    @Inject(ReportQueryService) private readonly reports: ReportQueryService,
    @Inject(ReviewEventsService) private readonly events: ReviewEventsService,
  ) {}

  @Post()
  async create(@Body() body: CreateReviewRequest): Promise<ReviewJob> {
    try {
      return await this.orchestrator.createReview(body);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({ message: 'Invalid review request.', issues: issuesOf(error) });
      }
      if (error instanceof ActiveReviewExistsError) {
        throw new ConflictException({ message: redactSecrets(error.message), activeReviewId: error.activeJobId });
      }
      if (error instanceof ProviderNotSelectableError) {
        // Provider status text can carry CLI diagnostics; never echo credentials.
        throw new UnprocessableEntityException({ message: redactSecrets(error.message) });
      }
      throw error;
    }
  }

  /** Declared before `:reviewId` so "active" is never parsed as an id. 204 when nothing is active. */
  @Get('active')
  async active(@Res({ passthrough: true }) response: { status(code: number): unknown }): Promise<ReviewJob | undefined> {
    const review = await this.reports.getActiveReview();
    if (!review) {
      response.status(204);

      return undefined;
    }

    return review;
  }

  @Get()
  list(@Query() query: Record<string, unknown>): Promise<ReviewHistoryPage> {
    const parsed = ReviewHistoryQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Invalid history query.', issues: issuesOf(parsed.error) });
    }

    return this.reports.listReviews(parsed.data);
  }

  @Get(':reviewId')
  async get(@Param('reviewId') reviewId: string): Promise<ReviewJob> {
    return this.require(reviewId);
  }

  @Post(':reviewId/cancel')
  @HttpCode(200)
  async cancel(@Param('reviewId') reviewId: string): Promise<ReviewJob> {
    await this.require(reviewId);
    try {
      return await this.orchestrator.cancelReview(reviewId);
    } catch (error) {
      if (error instanceof ReviewNotFoundError) throw new NotFoundException('Review not found.');
      throw error;
    }
  }

  /**
   * Unnamed SSE messages whose JSON `data` is a `ReviewEvent` (the `type`
   * discriminator is inside the payload), so `EventSource.onmessage` receives
   * every event. The first message is always a `job.snapshot`.
   */
  @Sse(':reviewId/events')
  async stream(@Param('reviewId') reviewId: string): Promise<Observable<MessageEvent>> {
    await this.require(reviewId);

    return this.events
      .stream(reviewId, () => this.reports.getReview(reviewId))
      .pipe(map((event) => ({ id: String(event.sequence), data: event })));
  }

  @Get(':reviewId/report.md')
  async report(
    @Param('reviewId') reviewId: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<string> {
    const stored = UUID.test(reviewId) ? await this.reports.getReportMarkdown(reviewId) : null;
    if (!stored) throw new NotFoundException('No report is available for this review.');

    response.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${stored.filename}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');

    return stored.markdown;
  }

  private async require(reviewId: string): Promise<ReviewJob> {
    const review = UUID.test(reviewId) ? await this.reports.getReview(reviewId) : null;
    if (!review) throw new NotFoundException('Review not found.');

    return review;
  }
}
