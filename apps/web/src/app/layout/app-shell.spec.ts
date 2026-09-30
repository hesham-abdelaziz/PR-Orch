import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AppShellComponent } from './app-shell.component';
import { AuthStore } from '../core/auth/auth.store';

describe('AppShellComponent', () => {
  let fixture: ComponentFixture<AppShellComponent>;
  let component: AppShellComponent;
  let authStoreMock: {
    username: any;
    isAuthenticated: any;
    logout: ReturnType<typeof vi.fn>;
  };
  let router: Router;

  beforeEach(async () => {
    authStoreMock = {
      username: vi.fn().mockReturnValue('test-engineer'),
      isAuthenticated: vi.fn().mockReturnValue(true),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: authStoreMock },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(AppShellComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders sidebar navigation with required links', () => {
    const el = fixture.nativeElement as HTMLElement;
    const nav = el.querySelector('nav');
    expect(nav).toBeTruthy();

    const links = Array.from(el.querySelectorAll('nav a')).map((a) =>
      a.getAttribute('routerLink'),
    );
    expect(links).toContain('/reviews/new');
    expect(links).toContain('/reviews/history');
    expect(links).toContain('/standards');
    expect(links).toContain('/settings');
  });

  it('renders persistent read-only indicator in the top status bar', () => {
    const el = fixture.nativeElement as HTMLElement;
    const readOnlyBadge = el.querySelector('.read-only-badge');
    expect(readOnlyBadge).toBeTruthy();
    expect(readOnlyBadge?.textContent).toContain('Read-Only');
  });

  it('displays authenticated username in header', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('test-engineer');
  });

  it('triggers logout and redirects to login when sign out is clicked', async () => {
    const el = fixture.nativeElement as HTMLElement;
    const logoutBtn = el.querySelector<HTMLButtonElement>('button#logout-btn');
    expect(logoutBtn).toBeTruthy();

    logoutBtn?.click();
    await fixture.whenStable();

    expect(authStoreMock.logout).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
  });

  it('contains accessible landmarks for header, nav, and main content', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('header')).toBeTruthy();
    expect(el.querySelector('nav')).toBeTruthy();
    expect(el.querySelector('main')).toBeTruthy();
  });
});
