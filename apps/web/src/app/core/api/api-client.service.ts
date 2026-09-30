import { Injectable } from '@angular/core';
import { z } from 'zod';
import { ApiError } from './api-error';

export interface RequestOptions<T> {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  schema?: z.ZodType<T>;
  body?: unknown;
  headers?: Record<string, string>;
  responseType?: 'json' | 'text';
}

export type RequestTextOptions = Omit<RequestOptions<string>, 'responseType' | 'schema'> & {
  schema?: z.ZodType<string>;
};

@Injectable({ providedIn: 'root' })
export class ApiClientService {
  private unauthorizedHandlers: Array<() => void> = [];

  onUnauthorized(handler: () => void): () => void {
    this.unauthorizedHandlers.push(handler);
    return () => {
      this.unauthorizedHandlers = this.unauthorizedHandlers.filter((h) => h !== handler);
    };
  }

  requestText(options: RequestTextOptions): Promise<string> {
    return this.request<string>({
      ...options,
      responseType: 'text',
    });
  }

  async request<T>(options: RequestOptions<T>): Promise<T> {
    const isText = options.responseType === 'text';
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

    if (!response.ok) {
      let errObj: Record<string, unknown> = {};
      let errText = '';
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          const json = await response.json();
          if (json && typeof json === 'object') {
            errObj = json as Record<string, unknown>;
          }
        } catch {
          // Ignore parse failure on error body
        }
      } else {
        try {
          errText = await response.text();
        } catch {
          // Ignore text failure on error body
        }
      }

      const code = typeof errObj['code'] === 'string' ? errObj['code'] : `HTTP_${response.status}`;
      const message =
        typeof errObj['message'] === 'string'
          ? errObj['message']
          : (errText.trim() || response.statusText || 'Request failed');
      throw new ApiError(response.status, code, message, errObj['details']);
    }

    if (isText) {
      const text = await response.text();
      if (options.schema) {
        const parseResult = options.schema.safeParse(text);
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
      return text as unknown as T;
    }

    let data: unknown = null;
    if (response.status === 204) {
      data = null;
    } else {
      try {
        data = await response.json();
      } catch {
        throw new ApiError(
          response.status,
          'MALFORMED_JSON',
          'Failed to parse server response as JSON',
        );
      }
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
