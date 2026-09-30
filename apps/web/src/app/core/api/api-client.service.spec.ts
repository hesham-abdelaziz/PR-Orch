import { TestBed } from '@angular/core/testing';
import { z } from 'zod';
import { ApiClientService } from './api-client.service';
import { ApiError } from './api-error';

describe('ApiClientService', () => {
  let service: ApiClientService;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ApiClientService],
    });
    service = TestBed.inject(ApiClientService);
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends request with same-origin credentials and JSON headers', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await service.request({
      method: 'POST',
      path: '/api/test',
      body: { key: 'value' },
    });

    expect(fetchSpy).toHaveBeenCalledWith('/api/test', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: 'value' }),
    });
    expect(result).toEqual({ ok: true });
  });

  it('validates response against a Zod schema', async () => {
    const TestSchema = z.strictObject({
      name: z.string(),
      count: z.number(),
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'review', count: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await service.request({
      method: 'GET',
      path: '/api/data',
      schema: TestSchema,
    });

    expect(result).toEqual({ name: 'review', count: 42 });
  });

  it('throws ApiError with SCHEMA_VALIDATION_ERROR on malformed response payload', async () => {
    const TestSchema = z.strictObject({
      name: z.string(),
      count: z.number(),
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 123, count: 'invalid' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      service.request({
        method: 'GET',
        path: '/api/data',
        schema: TestSchema,
      }),
    ).rejects.toThrow(ApiError);
  });

  it('throws normalized ApiError on HTTP error status with JSON body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'INVALID_CREDENTIALS',
          message: 'The username or password was incorrect',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    try {
      await service.request({
        method: 'POST',
        path: '/api/auth/login',
        body: { username: 'test', password: 'password12345' },
      });
      expect.fail('Expected request to throw');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.statusCode).toBe(400);
      expect(apiErr.code).toBe('INVALID_CREDENTIALS');
      expect(apiErr.message).toBe('The username or password was incorrect');
    }
  });

  it('triggers unauthorized handlers on 401 response', async () => {
    const unauthorizedCallback = vi.fn();
    const unsubscribe = service.onUnauthorized(unauthorizedCallback);

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'UNAUTHORIZED',
          message: 'Session expired',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    await expect(
      service.request({
        method: 'GET',
        path: '/api/protected',
      }),
    ).rejects.toThrow(ApiError);

    expect(unauthorizedCallback).toHaveBeenCalledTimes(1);

    unsubscribe();
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 401 }),
    );

    await expect(
      service.request({
        method: 'GET',
        path: '/api/protected',
      }),
    ).rejects.toThrow(ApiError);

    expect(unauthorizedCallback).toHaveBeenCalledTimes(1);
  });

  it('handles network failure and produces normalized ApiError', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    try {
      await service.request({
        method: 'GET',
        path: '/api/data',
      });
      expect.fail('Expected request to throw');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.statusCode).toBe(0);
      expect(apiErr.code).toBe('NETWORK_ERROR');
    }
  });

  it('preserves exact text/markdown content when requesting text response', async () => {
    const rawMarkdown = '# PR #101 Review Report\n\n- Finding 1: **Critical**\n- Evidence: `auth.go:42`\n';
    fetchSpy.mockResolvedValueOnce(
      new Response(rawMarkdown, {
        status: 200,
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      }),
    );

    const result = await service.requestText({
      method: 'GET',
      path: '/api/reviews/123/report.md',
    });

    expect(result).toBe(rawMarkdown);
  });

  it('handles empty text response without converting to null or object', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    const result = await service.requestText({
      method: 'GET',
      path: '/api/empty',
    });

    expect(result).toBe('');
  });

  it('throws ApiError on failed text/markdown request with status and error message', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('Report not found', {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    try {
      await service.requestText({
        method: 'GET',
        path: '/api/reviews/999/report.md',
      });
      expect.fail('Expected requestText to throw ApiError');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.statusCode).toBe(404);
      expect(apiErr.message).toContain('Report not found');
    }
  });

  it('rejects malformed JSON payload with MALFORMED_JSON error', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{ invalid json here', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    try {
      await service.request({
        method: 'GET',
        path: '/api/malformed-json',
      });
      expect.fail('Expected request to throw ApiError for malformed JSON');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('MALFORMED_JSON');
    }
  });
});
