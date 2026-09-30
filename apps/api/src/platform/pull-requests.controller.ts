import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ValidatePullRequestRequestSchema } from '@pr-orchestrator/contracts';
import { AzureDevOpsService } from '../azure-devops/azure-devops.service.js';
import { parseBody } from './http/parse-body.js';

@Controller('api/pull-requests')
export class PullRequestsController {
  constructor(
    @Inject(AzureDevOpsService) private readonly azure: AzureDevOpsService,
  ) {}
  @Post('validate')
  @HttpCode(200)
  validate(@Body() body: unknown) {
    return this.azure.validatePullRequest(
      parseBody(ValidatePullRequestRequestSchema, body).url,
    );
  }
}
