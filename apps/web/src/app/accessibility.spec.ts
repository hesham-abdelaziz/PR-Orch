import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import axe from 'axe-core';
import { AppShellComponent } from './layout/app-shell.component';
import { ApiClientService } from './core/api/api-client.service';
import { AuthStore } from './core/auth/auth.store';

describe('Accessibility Standards Audit', () => {
  let fixture: ComponentFixture<AppShellComponent>;
  let component: AppShellComponent;

  beforeEach(async () => {
    const authStoreMock = {
      username: vi.fn().mockReturnValue('local-admin'),
      user: vi.fn().mockReturnValue({ username: 'local-admin' }),
      logout: vi.fn().mockResolvedValue(undefined),
    };
    const apiClientMock = {
      request: vi.fn().mockResolvedValue({}),
    };

    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: authStoreMock },
        { provide: ApiClientService, useValue: apiClientMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AppShellComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('contains appropriate landmark regions: header, main, nav, aside', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('header')).toBeTruthy();
    expect(el.querySelector('main')).toBeTruthy();
    expect(el.querySelector('nav')).toBeTruthy();
    expect(el.querySelector('aside')).toBeTruthy();
  });

  it('ensures all interactive buttons have accessible text labels or aria-labels', () => {
    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    for (const btn of Array.from(buttons)) {
      const hasText = (btn.textContent?.trim().length ?? 0) > 0;
      const hasAriaLabel = btn.hasAttribute('aria-label');
      const hasTitle = btn.hasAttribute('title');
      expect(hasText || hasAriaLabel || hasTitle).toBe(true);
    }
  });

  it('runs axe-core accessibility audit with zero critical or serious violations', async () => {
    const el = fixture.nativeElement as HTMLElement;
    const results = await axe.run(el, {
      rules: {
        // In jsdom unit tests, color-contrast can't compute real css render trees
        'color-contrast': { enabled: false },
      },
    });

    const criticalViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    if (criticalViolations.length > 0) {
      console.error('Axe violations found:', JSON.stringify(criticalViolations, null, 2));
    }

    expect(criticalViolations.length).toBe(0);
  });
});
