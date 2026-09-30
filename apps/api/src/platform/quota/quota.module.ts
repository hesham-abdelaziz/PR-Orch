import { Module } from '@nestjs/common';
import { WindowsCliResolver } from '../../providers/windows-cli-resolver.js';
import { readCodexQuotaProcess } from './codex-process.js';
import { ProviderQuotaController } from './quota.controller.js';
import { ProviderQuotaService } from './quota.service.js';
import { unavailable } from './quota-source.js';

@Module({
  controllers: [ProviderQuotaController],
  providers: [
    {
      provide: ProviderQuotaService,
      useFactory: () => {
        const resolver = new WindowsCliResolver();
        return new ProviderQuotaService([
          {
            provider: 'codex',
            read: async (signal) => {
              const executable = resolver.locate('codex');
              return executable
                ? readCodexQuotaProcess(executable, signal)
                : unavailable('cli_missing');
            },
          },
        ]);
      },
    },
  ],
  exports: [ProviderQuotaService],
})
export class ProviderQuotaModule {}
