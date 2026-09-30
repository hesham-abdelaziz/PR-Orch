import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ReviewHistoryPageComponent } from './review-history-page.component';
import { ApiClientService } from '../../core/api/api-client.service';
import { ReviewJob } from '@pr-orchestrator/contracts';

describe('ReviewHistoryPageComponent', () => {
  let fixture: ComponentFixture<ReviewHistoryPageComponent>;
  let component: ReviewHistoryPageComponent;
  let apiClientMock: {
    request: ReturnType<typeof vi.fn>;
  };

  const mockHistoryJobs: ReviewJob[] = [
    {
      id: 'job-1',
      state: 'completed',
      pullRequest: {
        url: 'https://dev.azure.com/acme/proj/_git/auth-service/pullrequest/4819',
        organization: 'acme',
        project: 'proj',
        repository: 'auth-service',
        pullRequestId: 4819,
        title: 'Refactor OAuth2 token exchange',
        author: { id: 'u1', displayName: 'Elena Rostova' },
        sourceBranch: 'feat/auth',
        targetBranch: 'main',
        sourceCommit: 'abcdef1234567',
        targetCommit: '7654321fedcba',
        changedFiles: 14,
        additions: 482,
        deletions: 119,
        updatedAt: '2026-09-30T10:00:00.000Z',
      },
      main: { provider: 'claude', model: 'claude-3-7-sonnet' },
      reviewers: [
        {
          id: 'r1',
          selection: { provider: 'codex', model: 'gpt-4o' },
          state: 'completed',
          startedAt: null,
          completedAt: null,
          warning: null,
        },
      ],
      standards: null,
      warnings: [],
      createdAt: '2026-09-30T09:00:00.000Z',
      updatedAt: '2026-09-30T09:01:00.000Z',
      completedAt: '2026-09-30T09:01:00.000Z',
    },
    {
      id: 'job-2',
      state: 'cancelled',
      pullRequest: {
        url: 'https://dev.azure.com/acme/proj/_git/payment-gateway/pullrequest/1202',
        organization: 'acme',
        project: 'proj',
        repository: 'payment-gateway',
        pullRequestId: 1202,
        title: 'Add stripe webhook retry logic',
        author: { id: 'u2', displayName: 'Alex Chen' },
        sourceBranch: 'feat/webhook',
        targetBranch: 'main',
        sourceCommit: '1111111222222',
        targetCommit: '3333333444444',
        changedFiles: 4,
        additions: 80,
        deletions: 20,
        updatedAt: '2026-09-29T14:00:00.000Z',
      },
      main: { provider: 'codex', model: 'gpt-4o' },
      reviewers: [
        {
          id: 'r2',
          selection: { provider: 'gemini', model: 'gemini-1.5-pro' },
          state: 'cancelled',
          startedAt: null,
          completedAt: null,
          warning: null,
        },
      ],
      standards: null,
      warnings: [],
      createdAt: '2026-09-29T14:00:00.000Z',
      updatedAt: '2026-09-29T14:00:30.000Z',
      completedAt: '2026-09-29T14:00:30.000Z',
    },
    {
      id: 'job-3',
      state: 'failed',
      pullRequest: {
        url: 'https://dev.azure.com/acme/proj/_git/core-api/pullrequest/99',
        organization: 'acme',
        project: 'proj',
        repository: 'core-api',
        pullRequestId: 99,
        title: 'Migrate to Node 24 runtime',
        author: { id: 'u3', displayName: 'Marcus Vance' },
        sourceBranch: 'chore/node24',
        targetBranch: 'main',
        sourceCommit: '5555555666666',
        targetCommit: '7777777888888',
        changedFiles: 2,
        additions: 10,
        deletions: 10,
        updatedAt: '2026-09-28T11:00:00.000Z',
      },
      main: { provider: 'claude', model: 'claude-3-7-sonnet' },
      reviewers: [
        {
          id: 'r3',
          selection: { provider: 'codex', model: 'gpt-4o' },
          state: 'failed',
          startedAt: null,
          completedAt: null,
          warning: 'CLI error',
        },
      ],
      standards: null,
      warnings: ['All reviewers failed'],
      createdAt: '2026-09-28T11:00:00.000Z',
      updatedAt: '2026-09-28T11:01:00.000Z',
      completedAt: '2026-09-28T11:01:00.000Z',
    },
  ];

  beforeEach(async () => {
    apiClientMock = {
      request: vi.fn(),
    };

    apiClientMock.request.mockImplementation((opts) => {
      if (opts.path === '/api/reviews') {
        return Promise.resolve(mockHistoryJobs);
      }
      return Promise.resolve({});
    });

    await TestBed.configureTestingModule({
      imports: [ReviewHistoryPageComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClientService, useValue: apiClientMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReviewHistoryPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.loadHistory();
    fixture.detectChanges();
  });

  it('renders history table with search and filters', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Review History');
    expect(el.querySelector('#search-input')).toBeTruthy();
    expect(el.querySelector('#status-filter')).toBeTruthy();
  });

  it('displays history rows with correct status badges', () => {
    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('.history-row');
    expect(rows.length).toBe(3);

    expect(rows[0].textContent).toContain('PR #4819');
    expect(rows[0].textContent).toContain('COMPLETED');

    expect(rows[1].textContent).toContain('PR #1202');
    expect(rows[1].textContent).toContain('CANCELLED');

    expect(rows[2].textContent).toContain('PR #99');
    expect(rows[2].textContent).toContain('FAILED');
  });

  it('filters rows dynamically by search query', () => {
    component.searchTerm.set('stripe');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('.history-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Add stripe webhook retry logic');
  });

  it('filters rows by job status', () => {
    component.statusFilter.set('completed');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('.history-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Refactor OAuth2 token exchange');
  });

  it('navigates to report page on clicking a completed review row', async () => {
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));

    const el = fixture.nativeElement as HTMLElement;
    const firstRow = el.querySelector<HTMLElement>('.history-row');
    firstRow?.click();

    expect(navSpy).toHaveBeenCalledWith(['/reviews/job-1']);
  });
});
