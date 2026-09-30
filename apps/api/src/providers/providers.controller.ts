import { Controller, Get, Inject, Post } from '@nestjs/common';
import type { ProviderStatus } from '@pr-orchestrator/contracts';

import { ProviderRegistryService } from './provider-registry.service.js';

/**
 * Routes are declared with the full `api/` prefix from the locked HTTP
 * contract, so the application must not also set a global `api` prefix.
 */
@Controller('api/providers')
export class ProvidersController {
  constructor(
    @Inject(ProviderRegistryService) private readonly registry: ProviderRegistryService,
  ) {}

  @Get()
  list(): Promise<ProviderStatus[]> {
    return this.registry.getStatuses();
  }

  @Post('refresh')
  refresh(): Promise<ProviderStatus[]> {
    return this.registry.refresh();
  }
}
