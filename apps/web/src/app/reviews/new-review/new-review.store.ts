import { Injectable, computed, inject, signal } from '@angular/core';
import {
  CreateReviewRequest,
  CreateReviewRequestSchema,
  ModelSelection,
  PullRequestSummary,
  PullRequestSummarySchema,
  REPOSITORY_GUIDANCE_MAX_BYTES,
  RepositoryGuidance,
  RepositoryGuidanceSchema,
  ReviewJob,
  ReviewJobSchema,
  Settings,
  SettingsSchema,
  StandardsMetadata,
  StandardsMetadataSchema,
  ValidatePullRequestRequestSchema,
} from '@pr-orchestrator/contracts';
import { ApiClientService } from '../../core/api/api-client.service';
import { ApiError } from '../../core/api/api-error';
import { ProvidersStore } from '../../providers/providers.store';

@Injectable({
  providedIn: 'root',
})
export class NewReviewStore {
  private readonly apiClient = inject(ApiClientService);
  readonly providersStore = inject(ProvidersStore);

  readonly prUrl = signal<string>('');
  readonly prSummary = signal<PullRequestSummary | null>(null);
  readonly validatingPr = signal<boolean>(false);
  readonly prError = signal<string | null>(null);

  readonly mainSelection = signal<ModelSelection | null>(null);
  readonly reviewerSelections = signal<ModelSelection[]>([]);
  readonly additionalInstructions = signal<string>('');

  readonly repositoryGuidance = signal<RepositoryGuidance | null>(null);
  readonly guidanceFile = signal<{ name: string; size: number } | null>(null);
  readonly readingGuidance = signal<boolean>(false);
  readonly guidanceError = signal<string | null>(null);

  readonly standards = signal<StandardsMetadata | null>(null);
  readonly loadingStandards = signal<boolean>(false);

  readonly activeJob = signal<ReviewJob | null>(null);
  readonly checkingActiveJob = signal<boolean>(false);

  readonly submitting = signal<boolean>(false);
  readonly submitError = signal<string | null>(null);
  readonly activeReviewConflictId = signal<string | null>(null);

  readonly missingStandards = computed(() => !this.standards());
  readonly guidanceSize = computed(() => {
    const file = this.guidanceFile();
    if (file) return file.size;
    const g = this.repositoryGuidance();
    return g ? new TextEncoder().encode(g.content).byteLength : 0;
  });

  readonly hasDuplicateReviewers = computed(() => {
    const seen = new Set<string>();
    for (const r of this.reviewerSelections()) {
      const key = `${r.provider}:${r.model}`;
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  });

  readonly isMainAvailable = computed(() => {
    const main = this.mainSelection();
    if (!main) return false;
    const selectable = this.providersStore.selectableModels();
    return selectable.some(
      (m) => m.provider === main.provider && m.model === main.model,
    );
  });

  readonly canSubmit = computed(() => {
    if (this.submitting() || this.validatingPr() || this.readingGuidance()) return false;
    if (this.guidanceError()) return false;
    if (this.activeJob()) return false;
    if (!this.prSummary()) return false;
    if (!this.mainSelection()) return false;
    if (!this.isMainAvailable()) return false;
    if (this.reviewerSelections().length < 1 || this.reviewerSelections().length > 8) return false;
    if (this.hasDuplicateReviewers()) return false;

    // Verify all reviewers are available
    const selectable = this.providersStore.selectableModels();
    for (const r of this.reviewerSelections()) {
      const isAvailable = selectable.some((m) => m.provider === r.provider && m.model === r.model);
      if (!isAvailable) return false;
    }

    return true;
  });

  setPrUrl(url: string): void {
    if (this.prUrl() !== url) {
      this.prUrl.set(url);
      this.prSummary.set(null);
      this.prError.set(null);
    }
  }

  clearPr(): void {
    this.prUrl.set('');
    this.prSummary.set(null);
    this.prError.set(null);
  }

  async validatePr(): Promise<void> {
    const url = this.prUrl().trim();
    if (!url) {
      this.prError.set('Please enter an Azure DevOps Pull Request URL');
      return;
    }

    try {
      ValidatePullRequestRequestSchema.parse({ url });
    } catch {
      this.prError.set('Invalid Azure DevOps PR URL. Format: https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}');
      return;
    }

    this.validatingPr.set(true);
    this.prError.set(null);

    try {
      const summary = await this.apiClient.request({
        method: 'POST',
        path: '/api/pull-requests/validate',
        body: { url },
        schema: PullRequestSummarySchema,
      });
      this.prSummary.set(summary);
    } catch (err: unknown) {
      this.prSummary.set(null);
      if (err instanceof ApiError) {
        this.prError.set(err.message);
      } else {
        this.prError.set(err instanceof Error ? err.message : 'Failed to validate Pull Request');
      }
    } finally {
      this.validatingPr.set(false);
    }
  }

  setMainSelection(selection: ModelSelection | null): void {
    this.mainSelection.set(selection);
  }

  setReviewerSelections(reviewers: ModelSelection[]): void {
    this.reviewerSelections.set(reviewers);
  }

  addReviewer(selection: ModelSelection): boolean {
    if (this.reviewerSelections().length >= 8) {
      return false;
    }
    const alreadyExists = this.reviewerSelections().some(
      (r) => r.provider === selection.provider && r.model === selection.model,
    );
    if (alreadyExists) {
      return false;
    }
    this.reviewerSelections.update((list) => [...list, selection]);
    return true;
  }

  updateReviewerSelection(index: number, selection: ModelSelection): void {
    this.reviewerSelections.update((list) =>
      list.map((item, idx) => (idx === index ? selection : item)),
    );
  }

  removeReviewer(index: number): void {
    if (this.reviewerSelections().length <= 1) {
      return;
    }
    this.reviewerSelections.update((list) => list.filter((_, i) => i !== index));
  }

  setAdditionalInstructions(instructions: string): void {
    this.additionalInstructions.set(instructions);
  }

  async setGuidanceFile(file: File | null): Promise<void> {
    if (!file) {
      this.clearGuidance();
      return;
    }

    this.readingGuidance.set(true);
    this.guidanceError.set(null);
    this.repositoryGuidance.set(null);
    this.guidanceFile.set({ name: file.name, size: file.size });

    try {
      if (!/\.(md|txt)$/i.test(file.name)) {
        this.guidanceError.set('Guidance must be a .md or .txt file');
        return;
      }

      if (file.size > REPOSITORY_GUIDANCE_MAX_BYTES) {
        this.guidanceError.set('Guidance exceeds 64 KiB of UTF-8');
        return;
      }

      const buffer = await file.arrayBuffer();
      if (buffer.byteLength > REPOSITORY_GUIDANCE_MAX_BYTES) {
        this.guidanceError.set('Guidance exceeds 64 KiB of UTF-8');
        return;
      }

      let content: string;
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        content = decoder.decode(buffer);
      } catch {
        this.guidanceError.set('File is not valid UTF-8');
        return;
      }

      const parsed = RepositoryGuidanceSchema.safeParse({
        filename: file.name,
        content,
      });

      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        this.guidanceError.set(firstIssue?.message || 'Invalid repository guidance file');
        return;
      }

      this.repositoryGuidance.set(parsed.data);
      this.guidanceError.set(null);
    } catch (err: unknown) {
      this.guidanceError.set(err instanceof Error ? err.message : 'Failed to read guidance file');
    } finally {
      this.readingGuidance.set(false);
    }
  }

  clearGuidance(): void {
    this.repositoryGuidance.set(null);
    this.guidanceFile.set(null);
    this.guidanceError.set(null);
    this.readingGuidance.set(false);
  }

  async loadInitialData(): Promise<void> {
    await this.providersStore.load().catch(() => {});

    // Parallel load standards, active review, settings
    await Promise.all([
      this.loadStandards(),
      this.checkActiveJob(),
      this.loadSettingsDefaults(),
    ]);
  }

  async loadStandards(): Promise<void> {
    this.loadingStandards.set(true);
    try {
      const data = await this.apiClient.request({
        method: 'GET',
        path: '/api/standards',
        schema: StandardsMetadataSchema.nullable(),
      });
      this.standards.set(data);
    } catch {
      this.standards.set(null);
    } finally {
      this.loadingStandards.set(false);
    }
  }

  async checkActiveJob(): Promise<void> {
    this.checkingActiveJob.set(true);
    try {
      const job = await this.apiClient.request({
        method: 'GET',
        path: '/api/reviews/active',
        schema: ReviewJobSchema.nullable(),
      });
      const isActive = job && job.id && !['completed', 'failed', 'cancelled'].includes(job.state);
      this.activeJob.set(isActive ? job : null);
    } catch {
      this.activeJob.set(null);
    } finally {
      this.checkingActiveJob.set(false);
    }
  }

  private async loadSettingsDefaults(): Promise<void> {
    try {
      const settings = await this.apiClient.request({
        method: 'GET',
        path: '/api/settings',
        schema: SettingsSchema,
      });

      if (!this.mainSelection() && settings.defaultMain) {
        this.mainSelection.set(settings.defaultMain);
      }
      if (this.reviewerSelections().length === 0 && settings.defaultReviewers?.length) {
        this.reviewerSelections.set([...settings.defaultReviewers]);
      }
      if (!this.additionalInstructions() && settings.defaultAdditionalInstructions) {
        this.additionalInstructions.set(settings.defaultAdditionalInstructions);
      }
    } catch {
      // Fallback defaults if settings not available
      if (!this.mainSelection()) {
        const selectable = this.providersStore.selectableModels();
        if (selectable.length > 0) {
          const first = selectable[0];
          this.mainSelection.set({ provider: first.provider, model: first.model });
          if (this.reviewerSelections().length === 0) {
            this.reviewerSelections.set([{ provider: first.provider, model: first.model }]);
          }
        }
      }
    }
  }

  async createReview(): Promise<ReviewJob> {
    if (!this.canSubmit()) {
      throw new Error('Form validation failed: please verify all required fields.');
    }

    this.submitting.set(true);
    this.submitError.set(null);
    this.activeReviewConflictId.set(null);

    const guidance = this.repositoryGuidance();
    const payload: CreateReviewRequest = {
      pullRequestUrl: this.prUrl().trim(),
      main: this.mainSelection()!,
      reviewers: this.reviewerSelections(),
      additionalInstructions: this.additionalInstructions().trim() || undefined,
      ...(guidance ? { repositoryGuidance: guidance } : {}),
    };

    try {
      CreateReviewRequestSchema.parse(payload);

      const job = await this.apiClient.request({
        method: 'POST',
        path: '/api/reviews',
        body: payload,
        schema: ReviewJobSchema,
      });

      this.clearGuidance();
      return job;
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        this.submitError.set(err.message);
        if (err.statusCode === 409 && typeof err.data?.['activeReviewId'] === 'string') {
          this.activeReviewConflictId.set(err.data['activeReviewId']);
        }
      } else {
        this.submitError.set(err instanceof Error ? err.message : 'Failed to create review');
      }
      throw err;
    } finally {
      this.submitting.set(false);
    }
  }
}
