import { Injectable } from '@angular/core';
import { z } from 'zod';
import { ApiError } from './api-error';

export interface RequestOptions<T> {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  schema?: z.ZodType<T>;
  body?: unknown;
  headers?: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class ApiClientService {
  private unauthorizedHandlers: Array<() => void> = [];

  onUnauthorized(handler: () => void): () => void {
    this.unauthorizedHandlers.push(handler);
    return () => {
      this.unauthorizedHandlers = this.unauthorizedHandlers.filter((h) => h !== handler);
    };
  }

  async request<T>(options: RequestOptions<T>): Promise<T> {
    const headers: Record<string, string> = {
      ...(options.headers || {}),
    };

    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await fetch(options.path, {
        method: options.method,
        credentials: 'same-origin',
        headers,
        body,
      });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'Failed to communicate with server');
    }

    if (response.status === 401) {
      for (const handler of this.unauthorizedHandlers) {
        handler();
      }
    }

    let data: unknown = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      const errObj = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const code = typeof errObj['code'] === 'string' ? errObj['code'] : `HTTP_${response.status}`;
      const message =
        typeof errObj['message'] === 'string'
          ? errObj['message']
          : response.statusText || 'Request failed';
      throw new ApiError(response.status, code, message, errObj['details']);
    }

    if (options.schema) {
      const parseResult = options.schema.safeParse(data);
      if (!parseResult.success) {
        throw new ApiError(
          500,
          'SCHEMA_VALIDATION_ERROR',
          'Server response failed schema validation',
          parseResult.error.format(),
        );
      }
      return parseResult.data;
    }

    return data as T;
  }
}
