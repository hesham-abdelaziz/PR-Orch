import { Global, Module, Injectable, Inject, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DataSource } from 'typeorm';
import type { PullRequestSummary } from '@pr-orchestrator/contracts';
import { createPlatformDataSource } from '../database/data-source.js';
import { SqliteReviewRepository } from '../database/sqlite-review.repository.js';
import { REVIEW_REPOSITORY } from '../reviews/review-repository.js';
import { REVIEW_PULL_REQUEST_PORT, REVIEW_SETTINGS_PORT, REVIEW_STANDARDS_PORT, REVIEW_WORKSPACE_PORT } from '../reviews/review-ports.js';
import { REVIEW_ORCHESTRATOR_OPTIONS } from '../reviews/review-orchestrator.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StandardsService } from '../standards/standards.service.js';
import { AuthService } from '../auth/auth.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { SecretValuesService, WindowsCredentialStore, type SecretStore } from '../secrets/secret-store.js';
import { WorkspaceService } from '../workspace/workspace.service.js';

export const PLATFORM_DATABASE = Symbol('PLATFORM_DATABASE');
export interface PlatformOptions {
  dataRoot: string;
  gitExecutable: string;
  secretStore?: SecretStore;
  validatePullRequest: (url: string) => Promise<PullRequestSummary>;
  remoteForPullRequest?: (pr: PullRequestSummary) => string;
}
@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PLATFORM_DATABASE) private readonly db: DataSource) {}
  async onApplicationShutdown() { if (this.db.isInitialized) await this.db.destroy(); }
}
/** Global platform bindings consumed by the unchanged engine modules. Azure
 * validation is supplied by the platform Azure client, never by an AI adapter. */
@Global()
@Module({})
export class PlatformModule {
  static forRoot(options: PlatformOptions): DynamicModule {
    const root = resolve(options.dataRoot);
    const providers = [
      { provide: PLATFORM_DATABASE, useFactory: async () => { await mkdir(root, { recursive: true }); const db = await createPlatformDataSource(join(root, 'orchestrator.sqlite')).initialize(); await db.runMigrations(); return db; } },
      { provide: SecretValuesService, useFactory: async () => { const service = new SecretValuesService(options.secretStore ?? new WindowsCredentialStore()); await service.initialize(); return service; } },
      { provide: AuthService, inject: [PLATFORM_DATABASE], useFactory: (db: DataSource) => new AuthService(db) },
      { provide: SettingsService, inject: [PLATFORM_DATABASE], useFactory: (db: DataSource) => new SettingsService(db, root) },
      { provide: StandardsService, inject: [PLATFORM_DATABASE], useFactory: (db: DataSource) => new StandardsService(db, root) },
      { provide: REVIEW_REPOSITORY, inject: [PLATFORM_DATABASE], useFactory: (db: DataSource) => new SqliteReviewRepository(db) },
      { provide: REVIEW_SETTINGS_PORT, useExisting: SettingsService },
      { provide: REVIEW_STANDARDS_PORT, useExisting: StandardsService },
      { provide: REVIEW_PULL_REQUEST_PORT, useValue: { validate: options.validatePullRequest } },
      { provide: REVIEW_WORKSPACE_PORT, inject: [SecretValuesService, SettingsService], useFactory: (secrets: SecretValuesService, settings: SettingsService) => new WorkspaceService(join(root, 'workspaces'), options.gitExecutable, secrets, options.remoteForPullRequest, () => settings.get()) },
      { provide: REVIEW_ORCHESTRATOR_OPTIONS, inject: [SecretValuesService], useFactory: (secrets: SecretValuesService) => ({ secretValues: () => secrets.values() }) },
      { provide: APP_GUARD, useClass: SessionGuard }, DatabaseLifecycle,
    ];
    return { module: PlatformModule, providers, exports: [PLATFORM_DATABASE, SecretValuesService, AuthService, SettingsService, StandardsService, REVIEW_REPOSITORY, REVIEW_SETTINGS_PORT, REVIEW_STANDARDS_PORT, REVIEW_PULL_REQUEST_PORT, REVIEW_WORKSPACE_PORT, REVIEW_ORCHESTRATOR_OPTIONS] };
  }
}
