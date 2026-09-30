import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StandardsMetadata, StandardsMetadataSchema } from '@pr-orchestrator/contracts';
import { ApiClientService } from '../core/api/api-client.service';
import { ApiError } from '../core/api/api-error';

@Component({
  selector: 'app-standards-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="standards-page">
      <div class="page-header">
        <div class="breadcrumbs font-mono">
          <span>system</span> / <span>configuration</span> / <span class="active">standards</span>
        </div>
        <h1>Engineering Standards</h1>
        <p class="header-desc">
          Upload and manage the project coding standards file used during reviews.
          Each review snapshots the active version so replacing the file never changes historical reports.
        </p>
      </div>

      @if (loading()) {
        <div class="loading-state">Loading standards metadata...</div>
      } @else if (!metadata()) {
        <!-- No standards file uploaded -->
        <div class="warning-banner" role="alert">
          <span>⚠</span>
          <span>No standards file uploaded. Reviews will use detected framework and library best-practice guidance as a fallback.</span>
        </div>

        <div class="empty-card">
          <div class="empty-icon">§</div>
          <h2>No Standards File</h2>
          <p class="empty-desc">
            When no standards file is present, reviewers and the verifier will fall back to
            detected framework and library best-practice guidance. The final report will include
            an amber warning indicating this fallback was used.
          </p>
          <div class="upload-section">
            <label for="standards-upload" class="btn-primary upload-btn">
              Upload Standards File (.md / .txt)
            </label>
            <input
              id="standards-upload"
              type="file"
              accept=".md,.txt,text/markdown,text/plain"
              class="hidden-file-input"
              (change)="onFileSelected($event)"
              [disabled]="uploading()"
            />
            <span class="upload-hint">UTF-8, maximum 1 MiB</span>
          </div>
        </div>
      } @else {
        <!-- Standards metadata present -->
        @if (errorMessage()) {
          <div class="error-banner" role="alert">
            <span>⚠</span>
            <span>{{ errorMessage() }}</span>
          </div>
        }

        @if (successMessage()) {
          <div class="success-banner" role="status">
            <span>✓</span>
            <span>{{ successMessage() }}</span>
          </div>
        }

        <div class="standards-card">
          <div class="card-header-row">
            <div class="file-title-row">
              <span class="file-icon">§</span>
              <h2>{{ metadata()!.filename }}</h2>
              <span class="version-badge font-mono">v{{ metadata()!.versionId.slice(0, 8) }}</span>
            </div>
            <div class="card-actions">
              <label for="standards-replace" class="btn-secondary replace-btn">
                {{ uploading() ? 'Uploading...' : 'Replace File' }}
              </label>
              <input
                id="standards-replace"
                type="file"
                accept=".md,.txt,text/markdown,text/plain"
                class="hidden-file-input"
                (change)="onFileSelected($event)"
                [disabled]="uploading()"
              />
            </div>
          </div>

          <!-- Metadata Grid -->
          <div class="meta-grid">
            <div class="meta-item">
              <span class="meta-label">Filename</span>
              <span class="meta-value font-mono">{{ metadata()!.filename }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">File Size</span>
              <span class="meta-value">{{ formatBytes(metadata()!.sizeBytes) }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">SHA-256 Hash</span>
              <span class="meta-value font-mono hash-value" [title]="metadata()!.sha256">
                {{ metadata()!.sha256 }}
              </span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Uploaded At</span>
              <span class="meta-value">{{ metadata()!.uploadedAt | date:'medium' }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Version ID</span>
              <span class="meta-value font-mono">{{ metadata()!.versionId }}</span>
            </div>
          </div>

          <!-- Immutability Notice -->
          <div class="immutable-notice">
            <span class="notice-icon">🔒</span>
            <span>Replacing this file will never mutate historical review reports. Each review snapshots the active version at job creation.</span>
          </div>

          <!-- Content Preview -->
          @if (contentPreview()) {
            <div class="preview-section">
              <div class="preview-header">
                <span class="preview-title font-mono">CONTENT PREVIEW (escaped plain text)</span>
              </div>
              <pre class="standards-content">{{ contentPreview() }}</pre>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    @use '../../styles/tokens' as *;
    @use '../../styles/mixins' as *;

    .standards-page {
      padding: 24px 32px;
      max-width: 960px;
    }

    .page-header {
      margin-bottom: 24px;

      .breadcrumbs {
        font-size: 11px;
        color: $text-muted;
        margin-bottom: 8px;

        .active {
          color: $accent-primary;
        }
      }

      h1 {
        font-size: 20px;
        font-weight: 700;
        color: $text-primary;
        margin-bottom: 6px;
      }

      .header-desc {
        font-size: 13px;
        color: $text-secondary;
        max-width: 720px;
      }
    }

    .loading-state {
      @include card-surface;
      padding: 32px;
      text-align: center;
      color: $text-muted;
    }

    .empty-card {
      @include card-surface;
      padding: 40px 32px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;

      .empty-icon {
        font-size: 32px;
        color: $accent-primary;
        opacity: 0.6;
      }

      h2 {
        font-size: 16px;
        font-weight: 600;
        color: $text-primary;
      }

      .empty-desc {
        font-size: 13px;
        color: $text-secondary;
        max-width: 480px;
        line-height: 1.5;
      }
    }

    .upload-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
    }

    .upload-btn {
      cursor: pointer;
    }

    .upload-hint {
      font-size: 11px;
      color: $text-muted;
    }

    .hidden-file-input {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      border: 0;
    }

    .standards-card {
      @include card-surface;
      padding: 24px;
    }

    .card-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid $border-subtle;
    }

    .file-title-row {
      display: flex;
      align-items: center;
      gap: 10px;

      .file-icon {
        font-size: 18px;
        color: $accent-primary;
      }

      h2 {
        font-size: 15px;
        font-weight: 600;
        color: $text-primary;
      }
    }

    .version-badge {
      @include mono-badge;
      background-color: $bg-surface-3;
      color: $text-secondary;
    }

    .replace-btn {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }

    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .meta-label {
      font-size: 11px;
      font-weight: 500;
      color: $text-muted;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .meta-value {
      font-size: 12px;
      color: $text-primary;
    }

    .hash-value {
      word-break: break-all;
      font-size: 11px;
    }

    .font-mono {
      font-family: $font-mono;
    }

    .immutable-notice {
      background-color: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 6px;
      padding: 12px 14px;
      font-size: 12px;
      color: $accent-primary;
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;

      .notice-icon {
        font-size: 14px;
      }
    }

    .success-banner {
      background-color: rgba(63, 185, 80, 0.15);
      border: 1px solid rgba(63, 185, 80, 0.4);
      color: #9df2a6;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 12px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .preview-section {
      border-top: 1px solid $border-subtle;
      padding-top: 16px;
    }

    .preview-header {
      margin-bottom: 10px;
    }

    .preview-title {
      font-size: 10px;
      color: $text-muted;
      letter-spacing: 0.05em;
    }

    .standards-content {
      background-color: $bg-surface-1;
      border: 1px solid $border-subtle;
      border-radius: 6px;
      padding: 16px;
      font-family: $font-mono;
      font-size: 12px;
      line-height: 1.6;
      color: $text-primary;
      max-height: 400px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  `],
})
export class StandardsPageComponent implements OnInit {
  private readonly apiClient = inject(ApiClientService);

  metadata = signal<StandardsMetadata | null>(null);
  contentPreview = signal<string | null>(null);
  loading = signal(true);
  uploading = signal(false);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.loadMetadata();
  }

  async loadMetadata(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      const data = await this.apiClient.request({
        method: 'GET',
        path: '/api/standards',
        schema: StandardsMetadataSchema.nullable(),
      });
      this.metadata.set(data);

      if (data) {
        await this.loadContentPreview();
      }
    } catch {
      this.metadata.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  async loadContentPreview(): Promise<void> {
    try {
      const data = await this.apiClient.request<{ content: string }>({
        method: 'GET',
        path: '/api/standards/content',
      });
      this.contentPreview.set(data?.content ?? null);
    } catch {
      this.contentPreview.set(null);
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Validate file type in UI
    const validExtensions = ['.md', '.txt'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!validExtensions.includes(ext)) {
      this.errorMessage.set('Only .md and .txt files are accepted.');
      input.value = '';
      return;
    }

    // Validate file size in UI
    if (file.size > 1_048_576) {
      this.errorMessage.set('File exceeds the 1 MiB maximum size.');
      input.value = '';
      return;
    }

    this.uploading.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const text = await file.text();

      const data = await this.apiClient.request({
        method: 'PUT',
        path: '/api/standards',
        body: { filename: file.name, content: text },
        schema: StandardsMetadataSchema,
      });
      this.metadata.set(data);
      this.successMessage.set(`Standards file "${file.name}" uploaded successfully.`);
      await this.loadContentPreview();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        this.errorMessage.set(err.message);
      } else {
        this.errorMessage.set('Failed to upload standards file.');
      }
    } finally {
      this.uploading.set(false);
      input.value = '';
    }
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1_048_576).toFixed(2)} MB`;
  }
}
