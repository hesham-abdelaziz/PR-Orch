import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { signedOutGuard } from './core/auth/signed-out.guard';
import { AppShellComponent } from './layout/app-shell.component';
import { SetupPageComponent } from './auth/setup-page.component';
import { LoginPageComponent } from './auth/login-page.component';


export const routes: Routes = [
  {
    path: 'auth/setup',
    component: SetupPageComponent,
    canActivate: [signedOutGuard],
  },
  {
    path: 'auth/login',
    component: LoginPageComponent,
    canActivate: [signedOutGuard],
  },
  {
    path: '',
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'reviews/new',
      },
      {
        path: 'reviews/new',
        loadComponent: () =>
          import('./reviews/new-review/new-review-page.component').then((m) => m.NewReviewPageComponent),
      },
      {
        path: 'reviews/history',
        loadComponent: () =>
          import('./reviews/history/review-history-page.component').then((m) => m.ReviewHistoryPageComponent),
      },
      {
        path: 'reviews/active',
        loadComponent: () =>
          import('./reviews/active-review/active-review-page.component').then((m) => m.ActiveReviewPageComponent),
      },
      {
        path: 'reviews/:reviewId',
        loadComponent: () =>
          import('./reviews/report/report-page.component').then((m) => m.ReportPageComponent),
      },
      {
        path: 'standards',
        loadComponent: () =>
          import('./standards/standards-page.component').then((m) => m.StandardsPageComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./settings/settings-page.component').then((m) => m.SettingsPageComponent),
      },
      {
        path: 'release-notes',
        loadComponent: () =>
          import('./release/release-notes-page.component').then((m) => m.ReleaseNotesPageComponent),
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'reviews/new',
  },
];
