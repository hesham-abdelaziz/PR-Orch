import {
  Global,
  Module,
  Injectable,
  Inject,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DataSource } from 'typeorm';
import type { PullRequestSummary } from '@pr-orchestrator/contracts';
import { createPlatformDataSource } from '../database/data-source.js';
import { SqliteReviewRepository } from '../database/sqlite-review.repository.js';
import { REVIEW_REPOSITORY } from '../reviews/review-repository.js';
import {
  REVIEW_PULL_REQUEST_PORT,
  REVIEW_SETTINGS_PORT,
  REVIEW_STANDARDS_PORT,
  REVIEW_WORKSPACE_PORT,
} from '../reviews/review-ports.js';
import { REVIEW_ORCHESTRATOR_OPTIONS } from '../reviews/review-orchestrator.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StandardsService } from '../standards/standards.service.js';
import { AuthService } from '../auth/auth.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  SecretValuesService,
  WindowsCredentialStore,
  type SecretStore,
} from '../secrets/secret-store.js';
import { WorkspaceService } from '../workspace/workspace.service.js';
import {
  AzureDevOpsService,
  type AzureOptions,
} from '../azure-devops/azure-devops.service.js';
import { AuthController } from '../auth/auth.controller.js';
import {
  SettingsController,
  PLATFORM_AZURE_AUTH_HTTP,
} from '../settings/settings.controller.js';
import { StandardsController } from '../standards/standards.controller.js';
import { PullRequestsController } from './pull-requests.controller.js';

export const PLATFORM_DATABASE = Symbol('PLATFORM_DATABASE');
export interface PlatformOptions {
  dataRoot: string;
  gitExecutable: string;
  secretStore?: SecretStore;
  validatePullRequest?: (url: string) => Promise<PullRequestSummary>;
  azure?: AzureOptions;
  remoteForPullRequest?: (pr: PullRequestSummary) => string;
  /** Runtime lease released after engine module destruction and database close. */
  onShutdown?: () => Promise<void>;
}
@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(PLATFORM_DATABASE) private readonly db: DataSource,
    private readonly release?: () => Promise<void>,
  ) {}
  async onApplicationShutdown() {
    try {
      if (this.db.isInitialized) await this.db.destroy();
    } finally {
      await this.release?.();
    }
  }
}
/** Global platform bindings consumed by the unchanged engine modules. Azure
 * validation is supplied by the platform Azure client, never by an AI adapter. */
@Global()
@Module({})
export class PlatformModule {
  static forRoot(options: PlatformOptions): DynamicModule {
    const root = resolve(options.dataRoot);
    const providers = [
      {
        provide: PLATFORM_DATABASE,
        useFactory: async () => {
          await mkdir(root, { recursive: true });
          const db = await createPlatformDataSource(
            join(root, 'orchestrator.sqlite'),
          ).initialize();
          await db.runMigrations();
          return db;
        },
      },
      {
        provide: SecretValuesService,
        useFactory: async () => {
          const service = new SecretValuesService(
            options.secretStore ?? new WindowsCredentialStore(),
          );
          await service.initialize();
          return service;
        },
      },
      {
        provide: AuthService,
        inject: [PLATFORM_DATABASE],
        useFactory: (db: DataSource) => new AuthService(db),
      },
      {
        provide: SettingsService,
        inject: [PLATFORM_DATABASE],
        useFactory: (db: DataSource) => new SettingsService(db, root),
      },
      {
        provide: StandardsService,
        inject: [PLATFORM_DATABASE],
        useFactory: (db: DataSource) => new StandardsService(db, root),
      },
      {
        provide: AzureDevOpsService,
        inject: [SecretValuesService],
        useFactory: (secrets: SecretValuesService) =>
          new AzureDevOpsService(secrets, options.azure),
      },
      { provide: PLATFORM_AZURE_AUTH_HTTP, useExisting: AzureDevOpsService },
      {
        provide: REVIEW_REPOSITORY,
        inject: [PLATFORM_DATABASE],
        useFactory: (db: DataSource) => new SqliteReviewRepository(db),
      },
      { provide: REVIEW_SETTINGS_PORT, useExisting: SettingsService },
      { provide: REVIEW_STANDARDS_PORT, useExisting: StandardsService },
      {
        provide: REVIEW_PULL_REQUEST_PORT,
        inject: [AzureDevOpsService],
        useFactory: (azure: AzureDevOpsService) => ({
          validate:
            options.validatePullRequest ??
            ((url: string) => azure.validatePullRequest(url)),
        }),
      },
      {
        provide: REVIEW_WORKSPACE_PORT,
        inject: [SecretValuesService, SettingsService, AzureDevOpsService],
        useFactory: (
          secrets: SecretValuesService,
          settings: SettingsService,
          azure: AzureDevOpsService,
        ) =>
          new WorkspaceService(
            join(root, 'workspaces'),
            options.gitExecutable,
            secrets,
            options.remoteForPullRequest,
            () => settings.get(),
            () => azure.getGitCredential(),
          ),
      },
      {
        provide: REVIEW_ORCHESTRATOR_OPTIONS,
        inject: [SecretValuesService],
        useFactory: (secrets: SecretValuesService) => ({
          secretValues: () => secrets.values(),
        }),
      },
      { provide: APP_GUARD, useClass: SessionGuard },
      {
        provide: DatabaseLifecycle,
        inject: [PLATFORM_DATABASE],
        useFactory: (db: DataSource) =>
          new DatabaseLifecycle(db, options.onShutdown),
      },
    ];
    return {
      module: PlatformModule,
      controllers: [
        AuthController,
        SettingsController,
        StandardsController,
        PullRequestsController,
      ],
      providers,
      exports: [
        PLATFORM_DATABASE,
        SecretValuesService,
        AuthService,
        SettingsService,
        StandardsService,
        AzureDevOpsService,
        REVIEW_REPOSITORY,
        REVIEW_SETTINGS_PORT,
        REVIEW_STANDARDS_PORT,
        REVIEW_PULL_REQUEST_PORT,
        REVIEW_WORKSPACE_PORT,
        REVIEW_ORCHESTRATOR_OPTIONS,
      ],
    };
  }
}
