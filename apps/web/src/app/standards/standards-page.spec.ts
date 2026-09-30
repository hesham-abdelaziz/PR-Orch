import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StandardsPageComponent } from './standards-page.component';
import { ApiClientService } from '../core/api/api-client.service';
import { StandardsMetadata } from '@pr-orchestrator/contracts';

describe('StandardsPageComponent', () => {
  let fixture: ComponentFixture<StandardsPageComponent>;
  let component: StandardsPageComponent;
  let apiClientMock: {
    request: ReturnType<typeof vi.fn>;
  };

  const mockStandardsMetadata: StandardsMetadata = {
    versionId: '123e4567-e89b-12d3-a456-426614174000',
    filename: 'team-coding-standards.md',
    sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    sizeBytes: 14200,
    uploadedAt: '2026-09-29T10:00:00.000Z',
  };

  beforeEach(async () => {
    apiClientMock = {
      request: vi.fn(),
    };

    apiClientMock.request.mockImplementation((opts) => {
      if (opts.path === '/api/standards' && opts.method === 'GET') {
        return Promise.resolve(mockStandardsMetadata);
      }
      if (opts.path === '/api/standards/content' && opts.method === 'GET') {
        return Promise.resolve({ content: '# Team Standards\n\n- Do not commit secrets\n<script>alert(1)</script>' });
      }
      return Promise.resolve({});
    });

    await TestBed.configureTestingModule({
      imports: [StandardsPageComponent],
      providers: [{ provide: ApiClientService, useValue: apiClientMock }],
    }).compileComponents();
  });

  it('renders standards metadata including filename, sha256, and size', async () => {
    fixture = TestBed.createComponent(StandardsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.loadMetadata();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('team-coding-standards.md');
    expect(el.textContent).toContain('a1b2c3d4e5f60718293a4b5c6d7e8f90');
    expect(el.textContent).toContain('13.9 KB');
  });

  it('displays warning and fallback guidance when no standards file is uploaded', async () => {
    apiClientMock.request.mockImplementation((opts) => {
      if (opts.path === '/api/standards') {
        return Promise.resolve(null);
      }
      return Promise.resolve({});
    });

    fixture = TestBed.createComponent(StandardsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.loadMetadata();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.warning-banner')).toBeTruthy();
    expect(el.textContent).toContain('No standards file uploaded');
    expect(el.textContent).toContain('framework and library best-practice guidance');
  });

  it('previews content safely as escaped plain text without evaluating scripts', async () => {
    fixture = TestBed.createComponent(StandardsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.loadMetadata();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const previewBlock = el.querySelector('pre.standards-content');
    expect(previewBlock).toBeTruthy();
    expect(previewBlock?.innerHTML).not.toContain('<script>');
    expect(previewBlock?.textContent).toContain('<script>alert(1)</script>');
  });

  it('displays immutable historical version explanation notice', async () => {
    fixture = TestBed.createComponent(StandardsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.loadMetadata();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Replacing this file will never mutate historical review reports');
  });
});
