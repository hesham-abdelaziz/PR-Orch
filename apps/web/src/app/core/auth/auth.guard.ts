import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';

export const authGuard: CanActivateFn = async () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  let session = authStore.session();
  if (!session) {
    try {
      session = await authStore.checkSession();
    } catch {
      return router.createUrlTree(['/auth/login']);
    }
  }

  if (session.setupRequired) {
    return router.createUrlTree(['/auth/setup']);
  }

  if (!session.authenticated) {
    return router.createUrlTree(['/auth/login']);
  }

  return true;
};
