import { Module } from '@nestjs/common';

import { ProvidersModule } from '../providers/providers.module.js';
import { ProviderRegistryService } from '../providers/provider-registry.service.js';
import { ReportsModule } from '../reports/reports.module.js';
import { FindingNormalizerService } from './output/finding-normalizer.service.js';
import { ProviderOutputParser } from './output/provider-output.parser.js';
import { CorrectionPromptBuilder } from './prompts/correction-prompt.builder.js';
import { ReviewerPromptBuilder } from './prompts/reviewer-prompt.builder.js';
import { VerifierPromptBuilder } from './prompts/verifier-prompt.builder.js';
import { ReviewEventsService } from './review-events.service.js';
import { ReviewOrchestratorService } from './review-orchestrator.service.js';
import { REVIEW_PROVIDER_PORT } from './review-ports.js';
import { ReviewsController } from './reviews.controller.js';

/**
 * The platform must provide, in a module visible here (for example a
 * `@Global()` module): `REVIEW_REPOSITORY`, `REVIEW_WORKSPACE_PORT`,
 * `REVIEW_STANDARDS_PORT`, `REVIEW_SETTINGS_PORT` and
 * `REVIEW_PULL_REQUEST_PORT`. The provider port is bound here to the registry.
 */
@Module({
  imports: [ProvidersModule, ReportsModule],
  controllers: [ReviewsController],
  providers: [
    // Sequences are allocated through REVIEW_REPOSITORY; the clock token is optional.
    ReviewEventsService,
    ProviderOutputParser,
    FindingNormalizerService,
    ReviewerPromptBuilder,
    VerifierPromptBuilder,
    CorrectionPromptBuilder,
    { provide: REVIEW_PROVIDER_PORT, useExisting: ProviderRegistryService },
    ReviewOrchestratorService,
  ],
  exports: [ReviewOrchestratorService, ReviewEventsService],
})
export class ReviewsModule {}
