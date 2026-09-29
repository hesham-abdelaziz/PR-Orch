import { Test, TestingModule } from '@nestjs/testing';
import { ProviderStatusSchema } from '@pr-orchestrator/contracts';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  it('resolves the shared provider status contract', () => {
    expect(
      ProviderStatusSchema.safeParse({
        provider: 'codex',
        installed: true,
        authentication: { state: 'authenticated' },
        modelCatalog: { discovery: 'dynamic', models: [] },
        refreshedAt: '2026-09-29T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
