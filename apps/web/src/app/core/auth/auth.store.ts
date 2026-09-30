import { Injectable, computed, inject, signal } from '@angular/core';
import {
  AuthSession,
  AuthSessionSchema,
  ChangePasswordRequest,
  ChangePasswordRequestSchema,
  LoginRequest,
  LoginRequestSchema,
  SetupAccountRequest,
  SetupAccountRequestSchema,
} from '@pr-orchestrator/contracts';
import { ApiClientService } from '../api/api-client.service';
import { ApiError } from '../api/api-error';

import { ProviderQuotasStore } from '../../providers/provider-quotas.store';

@Injectable({ providedIn: 'root' })
export class AuthStore {
  readonly session = signal<AuthSession | null>(null);
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  readonly setupRequired = computed(() => this.session()?.setupRequired ?? false);
  readonly isAuthenticated = computed(() => this.session()?.authenticated ?? false);
  readonly username = computed(() => {
    const s = this.session();
    return s && s.authenticated ? s.username : null;
  });

  private readonly providerQuotasStore = inject(ProviderQuotasStore, { optional: true });

  constructor(private readonly apiClient: ApiClientService) {
    this.apiClient.onUnauthorized(() => {
      this.session.set({ authenticated: false, setupRequired: false });
      this.providerQuotasStore?.clear();
    });
  }

  async checkSession(): Promise<AuthSession> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const session = await this.apiClient.request({
        method: 'GET',
        path: '/api/auth/session',
        schema: AuthSessionSchema,
      });
      this.session.set(session);
      return session;
    } catch (err: unknown) {
      if (err instanceof ApiError && err.statusCode === 401) {
        const unauthSession: AuthSession = { authenticated: false, setupRequired: false };
        this.session.set(unauthSession);
        return unauthSession;
      }
      const message = err instanceof Error ? err.message : 'Failed to check session';
      this.error.set(message);
      throw err;
    } finally {
      this.loading.set(false);
    }
  }

  async setup(request: SetupAccountRequest): Promise<AuthSession> {
    SetupAccountRequestSchema.parse(request);
    this.loading.set(true);
    this.error.set(null);
    try {
      const session = await this.apiClient.request({
        method: 'POST',
        path: '/api/auth/setup',
        body: request,
        schema: AuthSessionSchema,
      });
      this.session.set(session);
      return session;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Setup failed';
      this.error.set(message);
      throw err;
    } finally {
      this.loading.set(false);
    }
  }

  async login(request: LoginRequest): Promise<AuthSession> {
    LoginRequestSchema.parse(request);
    this.loading.set(true);
    this.error.set(null);
    try {
      const session = await this.apiClient.request({
        method: 'POST',
        path: '/api/auth/login',
        body: request,
        schema: AuthSessionSchema,
      });
      this.session.set(session);
      return session;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      this.error.set(message);
      throw err;
    } finally {
      this.loading.set(false);
    }
  }

  async logout(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.apiClient.request({
        method: 'POST',
        path: '/api/auth/logout',
      });
    } catch {
      // In all cases, reset local session on logout
    } finally {
      this.session.set({ authenticated: false, setupRequired: false });
      this.providerQuotasStore?.clear();
      this.loading.set(false);
    }
  }

  async changePassword(request: ChangePasswordRequest): Promise<void> {
    ChangePasswordRequestSchema.parse(request);
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.apiClient.request({
        method: 'PUT',
        path: '/api/auth/password',
        body: request,
      });
      this.session.set({ authenticated: false, setupRequired: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Change password failed';
      this.error.set(message);
      throw err;
    } finally {
      this.loading.set(false);
    }
  }
}
