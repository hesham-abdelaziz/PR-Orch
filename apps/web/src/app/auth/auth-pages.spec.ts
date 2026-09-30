import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SetupPageComponent } from './setup-page.component';
import { LoginPageComponent } from './login-page.component';
import { AuthStore } from '../core/auth/auth.store';
import { ApiClientService } from '../core/api/api-client.service';
import { ApiError } from '../core/api/api-error';

describe('Auth Pages', () => {
  let authStoreMock: {
    session: any;
    setupRequired: any;
    isAuthenticated: any;
    username: any;
    loading: any;
    error: any;
    checkSession: ReturnType<typeof vi.fn>;
    setup: ReturnType<typeof vi.fn>;
    login: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };
  let router: Router;

  beforeEach(async () => {
    authStoreMock = {
      session: { set: vi.fn(), subscribe: vi.fn() },
      setupRequired: vi.fn().mockReturnValue(true),
      isAuthenticated: vi.fn().mockReturnValue(false),
      username: vi.fn().mockReturnValue(null),
      loading: vi.fn().mockReturnValue(false),
      error: vi.fn().mockReturnValue(null),
      checkSession: vi.fn().mockResolvedValue({ authenticated: false, setupRequired: true }),
      setup: vi.fn().mockResolvedValue({
        authenticated: true,
        setupRequired: false,
        username: 'admin',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
      login: vi.fn().mockResolvedValue({
        authenticated: true,
        setupRequired: false,
        username: 'admin',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [SetupPageComponent, LoginPageComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: authStoreMock },
        { provide: ApiClientService, useValue: {} },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  describe('SetupPageComponent', () => {
    let fixture: ComponentFixture<SetupPageComponent>;
    let component: SetupPageComponent;

    beforeEach(async () => {
      fixture = TestBed.createComponent(SetupPageComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('renders account setup form with username and password fields', () => {
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('input#username')).toBeTruthy();
      expect(el.querySelector('input#password')).toBeTruthy();
      expect(el.querySelector('button[type="submit"]')).toBeTruthy();
    });

    it('disables submit button when password length is under 12 characters', async () => {
      const el = fixture.nativeElement as HTMLElement;
      const usernameInput = el.querySelector<HTMLInputElement>('input#username')!;
      const passwordInput = el.querySelector<HTMLInputElement>('input#password')!;
      const submitBtn = el.querySelector<HTMLButtonElement>('button[type="submit"]')!;

      usernameInput.value = 'devuser';
      usernameInput.dispatchEvent(new Event('input'));
      passwordInput.value = 'short';
      passwordInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(submitBtn.disabled).toBe(true);
    });

    it('submits valid account setup and navigates to new review', async () => {
      const el = fixture.nativeElement as HTMLElement;
      const usernameInput = el.querySelector<HTMLInputElement>('input#username')!;
      const passwordInput = el.querySelector<HTMLInputElement>('input#password')!;
      const form = el.querySelector<HTMLFormElement>('form')!;

      usernameInput.value = 'admin';
      usernameInput.dispatchEvent(new Event('input'));
      passwordInput.value = 'super-secret-password-123';
      passwordInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      form.dispatchEvent(new Event('submit'));
      await fixture.whenStable();

      expect(authStoreMock.setup).toHaveBeenCalledWith({
        username: 'admin',
        password: 'super-secret-password-123',
      });
      expect(router.navigate).toHaveBeenCalledWith(['/reviews/new']);
    });

    it('preserves input fields on server error and displays error banner', async () => {
      authStoreMock.setup.mockRejectedValueOnce(
        new ApiError(400, 'SETUP_FAILED', 'Account setup failed: Username is reserved'),
      );

      const el = fixture.nativeElement as HTMLElement;
      const usernameInput = el.querySelector<HTMLInputElement>('input#username')!;
      const passwordInput = el.querySelector<HTMLInputElement>('input#password')!;
      const form = el.querySelector<HTMLFormElement>('form')!;

      usernameInput.value = 'reserved-name';
      usernameInput.dispatchEvent(new Event('input'));
      passwordInput.value = 'super-secret-password-123';
      passwordInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      form.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(usernameInput.value).toBe('reserved-name');
      expect(passwordInput.value).toBe('super-secret-password-123');
      const errorMsg = el.querySelector('.error-banner');
      expect(errorMsg?.textContent).toContain('Account setup failed');
    });
  });

  describe('LoginPageComponent', () => {
    let fixture: ComponentFixture<LoginPageComponent>;
    let component: LoginPageComponent;

    beforeEach(async () => {
      fixture = TestBed.createComponent(LoginPageComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('renders login form with username and password fields', () => {
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('input#username')).toBeTruthy();
      expect(el.querySelector('input#password')).toBeTruthy();
      expect(el.querySelector('button[type="submit"]')).toBeTruthy();
    });

    it('submits credentials and navigates upon success', async () => {
      const el = fixture.nativeElement as HTMLElement;
      const usernameInput = el.querySelector<HTMLInputElement>('input#username')!;
      const passwordInput = el.querySelector<HTMLInputElement>('input#password')!;
      const form = el.querySelector<HTMLFormElement>('form')!;

      usernameInput.value = 'devuser';
      usernameInput.dispatchEvent(new Event('input'));
      passwordInput.value = 'valid-password-123';
      passwordInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      form.dispatchEvent(new Event('submit'));
      await fixture.whenStable();

      expect(authStoreMock.login).toHaveBeenCalledWith({
        username: 'devuser',
        password: 'valid-password-123',
      });
      expect(router.navigate).toHaveBeenCalledWith(['/reviews/new']);
    });

    it('preserves form inputs and displays error on invalid credentials', async () => {
      authStoreMock.login.mockRejectedValueOnce(
        new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password'),
      );

      const el = fixture.nativeElement as HTMLElement;
      const usernameInput = el.querySelector<HTMLInputElement>('input#username')!;
      const passwordInput = el.querySelector<HTMLInputElement>('input#password')!;
      const form = el.querySelector<HTMLFormElement>('form')!;

      usernameInput.value = 'devuser';
      usernameInput.dispatchEvent(new Event('input'));
      passwordInput.value = 'wrong-password';
      passwordInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      form.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(usernameInput.value).toBe('devuser');
      expect(passwordInput.value).toBe('wrong-password');
      const errorMsg = el.querySelector('.error-banner');
      expect(errorMsg?.textContent).toContain('Invalid username or password');
    });
  });
});
