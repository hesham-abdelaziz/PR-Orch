import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';

export const signedOutGuard: CanActivateFn = async (route) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  let session = authStore.session();
  if (!session) {
    try {
      session = await authStore.checkSession();
    } catch {
      return true;
    }
  }

  if (session.authenticated) {
    return router.createUrlTree(['/reviews/new']);
  }

  const targetPath = route.routeConfig?.path;
  if (session.setupRequired && targetPath === 'login') {
    return router.createUrlTree(['/auth/setup']);
  }
  if (!session.setupRequired && targetPath === 'setup') {
    return router.createUrlTree(['/auth/login']);
  }

  return true;
};
