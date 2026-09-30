import { Module, type DynamicModule } from '@nestjs/common';
import {
  PlatformModule,
  type PlatformOptions,
} from './platform/platform.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { ReportReadController } from './platform/report-read.controller.js';
import { ProviderQuotaModule } from './platform/quota/quota.module.js';

@Module({})
export class AppModule {
  static forRoot(options: PlatformOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [PlatformModule.forRoot(options), ReviewsModule, ReportsModule, ProviderQuotaModule],
      controllers: [ReportReadController],
    };
  }
}
