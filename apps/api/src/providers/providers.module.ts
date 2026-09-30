import { homedir } from 'node:os';

import { Module } from '@nestjs/common';

import { ClaudeAdapter } from './adapters/claude.adapter.js';
import { CodexAdapter } from './adapters/codex.adapter.js';
import { GeminiAdapter } from './adapters/gemini.adapter.js';
import { discoverConfiguredModels } from './model-catalog.service.js';
import { ProcessSupervisor } from './process/process-supervisor.service.js';
import {
  InMemoryProviderSnapshotStore,
  ProviderRegistryService,
  type ProviderSnapshotStore,
} from './provider-registry.service.js';
import { ProvidersController } from './providers.controller.js';
import { WindowsCliResolver, nodeFileSystem } from './windows-cli-resolver.js';

/**
 * Optional override: the platform module can bind a database-backed
 * `provider_snapshots` store to this token. Defaults to an in-memory store.
 */
export const PROVIDER_SNAPSHOT_STORE = Symbol('PROVIDER_SNAPSHOT_STORE');

@Module({
  controllers: [ProvidersController],
  providers: [
    ProcessSupervisor,
    {
      provide: PROVIDER_SNAPSHOT_STORE,
      useFactory: (): ProviderSnapshotStore => new InMemoryProviderSnapshotStore(),
    },
    {
      provide: ProviderRegistryService,
      inject: [ProcessSupervisor, PROVIDER_SNAPSHOT_STORE],
      useFactory: (
        supervisor: ProcessSupervisor,
        snapshotStore: ProviderSnapshotStore,
      ): ProviderRegistryService => {
        const locator = new WindowsCliResolver();
        const home = homedir();
        const configured = (provider: 'claude' | 'codex' | 'gemini') =>
          discoverConfiguredModels(provider, { homeDirectory: home, fileSystem: nodeFileSystem });
        const shared = { supervisor, locator };

        return new ProviderRegistryService({
          adapters: [
            new ClaudeAdapter({ ...shared, configuredModels: configured('claude') }),
            new CodexAdapter({ ...shared, configuredModels: configured('codex') }),
            new GeminiAdapter({
              ...shared,
              configuredModels: configured('gemini'),
              sandboxAvailable: () =>
                locator.locateExecutable('docker') !== undefined ||
                locator.locateExecutable('podman') !== undefined,
            }),
          ],
          snapshotStore,
        });
      },
    },
  ],
  exports: [ProcessSupervisor, ProviderRegistryService],
})
export class ProvidersModule {}
