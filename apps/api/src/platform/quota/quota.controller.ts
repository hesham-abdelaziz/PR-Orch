import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ProviderQuotaService } from './quota.service.js';

// The global platform SessionGuard protects both routes; no public exemption.
@Controller('api/provider-quotas')
export class ProviderQuotaController {
  constructor(
    @Inject(ProviderQuotaService) private readonly quota: ProviderQuotaService,
  ) {}
  @Get() get() {
    return this.quota.get();
  }
  @Post('refresh') @HttpCode(200) refresh() {
    return this.quota.get(true);
  }
}
