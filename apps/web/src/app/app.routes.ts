import { Component } from '@angular/core';
import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { signedOutGuard } from './core/auth/signed-out.guard';
import { AppShellComponent } from './layout/app-shell.component';
import { SetupPageComponent } from './auth/setup-page.component';
import { LoginPageComponent } from './auth/login-page.component';

@Component({
  standalone: true,
  template: `<div class="p-6">Loading module...</div>`,
})
export class RoutePlaceholderComponent {}

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
        component: RoutePlaceholderComponent,
      },
      {
        path: 'reviews/history',
        component: RoutePlaceholderComponent,
      },
      {
        path: 'reviews/active',
        component: RoutePlaceholderComponent,
      },
      {
        path: 'reviews/:reviewId',
        component: RoutePlaceholderComponent,
      },
      {
        path: 'standards',
        component: RoutePlaceholderComponent,
      },
      {
        path: 'settings',
        component: RoutePlaceholderComponent,
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'reviews/new',
  },
];
