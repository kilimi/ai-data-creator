import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from './api';

function mockFetchResponse(body: object, status = 200, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(() => {
    client = new ApiClient({ baseUrl: 'http://localhost:9999' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('request', () => {
    it('makes a GET request and returns success response', async () => {
      const data = [{ id: 1, name: 'Project A' }];
      globalThis.fetch = mockFetchResponse({ success: true, data });

      const result = await client.getProjects();
      expect(result.success).toBe(true);
      expect(result.data).toEqual(data);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:9999/projects/?include_images=false',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('wraps non-ApiResponse data in success response', async () => {
      const rawData = { id: 1, name: 'Dataset' };
      globalThis.fetch = mockFetchResponse(rawData);

      const result = await client.request('/test');
      expect(result.success).toBe(true);
      expect(result.data).toEqual(rawData);
    });

    it('returns error for non-ok responses', async () => {
      globalThis.fetch = mockFetchResponse(
        { detail: 'Not found' },
        404,
      );

      const result = await client.request('/not-found');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
    });

    it('handles empty response with 204 status', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        headers: {
          get: (name: string) => {
            if (name.toLowerCase() === 'content-length') return '0';
            if (name.toLowerCase() === 'content-type') return '';
            return null;
          },
        },
        text: () => Promise.resolve(''),
      } as unknown as Response);

      const result = await client.request('/empty');
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('handles HTML error response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: {
          get: (name: string) => {
            if (name.toLowerCase() === 'content-type') return 'text/html';
            return null;
          },
        },
        text: () => Promise.resolve('<!DOCTYPE html><html><body>Bad Gateway</body></html>'),
      } as unknown as Response);

      const result = await client.request('/broken', {}, 1);
      expect(result.success).toBe(false);
      expect(result.error).toContain('HTML instead of JSON');
    });

    it('sets Content-Type for non-FormData bodies', async () => {
      globalThis.fetch = mockFetchResponse({ success: true });

      await client.request('/test', {
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
      });

      const calledOptions = (globalThis.fetch as any).mock.calls[0][1];
      expect(calledOptions.headers['Content-Type']).toBe('application/json');
    });

    it('does not set Content-Type for FormData', async () => {
      globalThis.fetch = mockFetchResponse({ success: true });

      const form = new FormData();
      form.append('name', 'test');
      await client.request('/test', { method: 'POST', body: form });

      const calledOptions = (globalThis.fetch as any).mock.calls[0][1];
      expect(calledOptions.headers['Content-Type']).toBeUndefined();
    });

    it('retries on network error', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: {
            get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
          },
          text: () => Promise.resolve(JSON.stringify({ success: true, data: 'ok' })),
        });
      });

      const result = await client.request('/flaky', {}, 2);
      expect(result.success).toBe(true);
      expect(callCount).toBe(2);
    });

    it('returns error after all retries exhausted', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      const result = await client.request('/down', {}, 2);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to fetch');
    });
  });

  describe('testConnection', () => {
    it('returns error if baseUrl points to port 8080', async () => {
      const frontendClient = new ApiClient({ baseUrl: 'http://localhost:8080' });
      const result = await frontendClient.testConnection();
      expect(result.success).toBe(false);
      expect(result.error).toContain('frontend port');
    });

    it('returns success for healthy backend', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok', database: 'connected' }),
      });

      const result = await client.testConnection();
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('ok');
    });

    it('returns success for degraded backend', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'degraded', database: 'disconnected' }),
      });

      const result = await client.testConnection();
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('degraded');
    });

    it('returns error on network failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await client.testConnection(1);
      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });
  });

  describe('endpoint methods build correct URLs', () => {
    beforeEach(() => {
      globalThis.fetch = mockFetchResponse({ success: true, data: {} });
    });

    it('getProject builds URL with query params', async () => {
      await client.getProject('5', { includeImages: true, includeDatasetAnnotationFiles: true });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/projects/5?include_images=true&include_dataset_annotation_files=true'),
        expect.any(Object)
      );
    });

    it('getProject builds URL without query params', async () => {
      await client.getProject('5');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:9999/projects/5',
        expect.any(Object)
      );
    });

    it('getTasks builds query string from params', async () => {
      await client.getTasks({ project_id: 1, status: 'running', limit: 10 });
      const url = (globalThis.fetch as any).mock.calls[0][0];
      expect(url).toContain('project_id=1');
      expect(url).toContain('status=running');
      expect(url).toContain('limit=10');
    });

    it('deleteProject uses DELETE method', async () => {
      await client.deleteProject(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:9999/projects/1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });
});
