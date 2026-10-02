import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import axe from 'axe-core';
import { routes } from '../app.routes';
import { SidebarComponent } from '../layout/sidebar.component';
import { AppShellComponent } from '../layout/app-shell.component';
import { AuthStore } from '../core/auth/auth.store';
import { ApiClientService } from '../core/api/api-client.service';
import { ReleaseNotesPageComponent } from './release-notes-page.component';
import { APP_VERSION, APP_CHANGELOG } from './release-info.generated';

describe('Release Versioning and Release Notes UI', () => {
  describe('SidebarComponent Dynamic Version & Release Notes Link', () => {
    let fixture: ComponentFixture<SidebarComponent>;
    let component: SidebarComponent;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [SidebarComponent],
        providers: [provideRouter([])],
      }).compileComponents();

      fixture = TestBed.createComponent(SidebarComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('binds brand-version to dynamic APP_VERSION from release metadata', () => {
      expect(component.appVersion).toBe(APP_VERSION);

      const el = fixture.nativeElement as HTMLElement;
      const brandVersion = el.querySelector('.brand-version');
      expect(brandVersion).toBeTruthy();
      expect(brandVersion?.textContent?.trim()).toBe(`v${APP_VERSION} • localhost`);
    });

    it('renders a release notes navigation link pointing to /release-notes', () => {
      const el = fixture.nativeElement as HTMLElement;
      const link = el.querySelector<HTMLAnchorElement>('a[routerLink="/release-notes"]');
      expect(link).toBeTruthy();
      expect(link?.textContent?.trim()).toContain('Release Notes');
      expect(link?.getAttribute('id')).toBe('nav-release-notes');
    });
  });

  describe('Routing & Authentication for /release-notes', () => {
    let authStoreMock: {
      username: any;
      isAuthenticated: any;
      session: any;
      checkSession: ReturnType<typeof vi.fn>;
      logout: ReturnType<typeof vi.fn>;
    };
    let router: Router;

    beforeEach(async () => {
      authStoreMock = {
        username: vi.fn().mockReturnValue('release-tester'),
        isAuthenticated: vi.fn().mockReturnValue(true),
        session: vi.fn().mockReturnValue({ authenticated: true, setupRequired: false, username: 'release-tester' }),
        checkSession: vi.fn().mockResolvedValue({ authenticated: true, setupRequired: false, username: 'release-tester' }),
        logout: vi.fn().mockResolvedValue(undefined),
      };

      await TestBed.configureTestingModule({
        imports: [AppShellComponent],
        providers: [
          provideRouter(routes),
          { provide: AuthStore, useValue: authStoreMock },
          { provide: ApiClientService, useValue: {} },
        ],
      }).compileComponents();

      router = TestBed.inject(Router);
    });

    it('registers /release-notes as a lazy route under authenticated AppShell', () => {
      const authenticatedShellRoute = routes.find((r) => r.component === AppShellComponent);
      expect(authenticatedShellRoute).toBeTruthy();
      expect(authenticatedShellRoute?.canActivate).toBeTruthy();

      const releaseNotesRoute = authenticatedShellRoute?.children?.find(
        (child) => child.path === 'release-notes',
      );
      expect(releaseNotesRoute).toBeTruthy();
      expect(typeof releaseNotesRoute?.loadComponent).toBe('function');
    });

    it('navigates to /release-notes when clicking the sidebar release notes link', async () => {
      const shellFixture = TestBed.createComponent(AppShellComponent);
      shellFixture.detectChanges();
      await shellFixture.whenStable();

      const el = shellFixture.nativeElement as HTMLElement;
      const link = el.querySelector<HTMLAnchorElement>('a#nav-release-notes');
      expect(link).toBeTruthy();

      // Actually click the DOM link to trigger RouterLink navigation
      link!.click();
      shellFixture.detectChanges();
      await shellFixture.whenStable();

      expect(router.url).toBe('/release-notes');
    });
  });

  describe('ReleaseNotesPageComponent Displayed Notes & Markdown Rendering', () => {
    let fixture: ComponentFixture<ReleaseNotesPageComponent>;
    let component: ReleaseNotesPageComponent;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [ReleaseNotesPageComponent],
        providers: [provideRouter([])],
      }).compileComponents();

      fixture = TestBed.createComponent(ReleaseNotesPageComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('binds page header badge dynamically to APP_VERSION', () => {
      expect(component.version).toBe(APP_VERSION);

      const el = fixture.nativeElement as HTMLElement;
      const badge = el.querySelector('#release-version-badge');
      expect(badge).toBeTruthy();
      expect(badge?.textContent?.trim()).toBe(`v${APP_VERSION}`);
    });

    it('renders APP_CHANGELOG using SafeMarkdownComponent without hardcoding brittle release prose', () => {
      expect(component.changelog).toBe(APP_CHANGELOG);

      const el = fixture.nativeElement as HTMLElement;
      const safeMarkdown = el.querySelector('app-safe-markdown');
      expect(safeMarkdown).toBeTruthy();

      // Heading 1 from markdown structure
      const h1 = el.querySelector('.safe-markdown-body h1');
      expect(h1).toBeTruthy();
      expect(h1?.textContent?.trim().length).toBeGreaterThan(0);

      // Current version heading reflects the active release version
      const h2Elements = Array.from(el.querySelectorAll('.safe-markdown-body h2'));
      const activeVersionHeading = h2Elements.find((h2) => h2.textContent?.includes(`[${APP_VERSION}]`));
      expect(activeVersionHeading).toBeTruthy();

      // Rendered body paragraph exists
      const paragraphs = el.querySelectorAll('.safe-markdown-body p');
      expect(paragraphs.length).toBeGreaterThan(0);

      // Rendered markdown links are present and valid
      const links = el.querySelectorAll<HTMLAnchorElement>('.safe-markdown-body a');
      expect(links.length).toBeGreaterThan(0);
    });

    it('passes axe-core accessibility audit with zero critical or serious violations', async () => {
      const el = fixture.nativeElement as HTMLElement;
      const results = await axe.run(el, {
        rules: {
          'color-contrast': { enabled: false },
        },
      });

      const criticalViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(criticalViolations).toHaveLength(0);
    });
  });
});
