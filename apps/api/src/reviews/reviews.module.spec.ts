import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ReportQueryService } from '../reports/report-query.service.js';
import { InMemoryReviewRepository } from './in-memory-review.repository.js';
import { ReviewOrchestratorService } from './review-orchestrator.service.js';
import {
  REVIEW_PULL_REQUEST_PORT,
  REVIEW_SETTINGS_PORT,
  REVIEW_STANDARDS_PORT,
  REVIEW_WORKSPACE_PORT,
} from './review-ports.js';
import { REVIEW_REPOSITORY } from './review-repository.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsModule } from './reviews.module.js';

const platformPort = (token: symbol, value: object) => ({ provide: token, useValue: value });

@Global()
@Module({
  providers: [
    platformPort(REVIEW_REPOSITORY, new InMemoryReviewRepository()),
    platformPort(REVIEW_WORKSPACE_PORT, {}),
    platformPort(REVIEW_STANDARDS_PORT, {}),
    platformPort(REVIEW_SETTINGS_PORT, {}),
    platformPort(REVIEW_PULL_REQUEST_PORT, {}),
  ],
  exports: [REVIEW_REPOSITORY, REVIEW_WORKSPACE_PORT, REVIEW_STANDARDS_PORT, REVIEW_SETTINGS_PORT, REVIEW_PULL_REQUEST_PORT],
})
class FakePlatformModule {}

describe('ReviewsModule', () => {
  it('wires the whole engine once the platform supplies its five ports', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, ReviewsModule] }).compile();

    expect(moduleRef.get(ReviewsController)).toBeInstanceOf(ReviewsController);
    expect(moduleRef.get(ReviewOrchestratorService)).toBeInstanceOf(ReviewOrchestratorService);
    expect(moduleRef.get(ReportQueryService, { strict: false })).toBeInstanceOf(ReportQueryService);
    await moduleRef.close();
  });
});
