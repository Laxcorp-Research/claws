import { describe, it, expect } from 'vitest';
import { apiSuccess, apiError, ERRORS } from '@/lib/api/response';

describe('apiSuccess', () => {
  it('returns 200 with success envelope', async () => {
    const res = apiSuccess({ foo: 'bar' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ foo: 'bar' });
    expect(json.meta).toBeDefined();
    expect(json.meta.timestamp).toBeDefined();
    expect(json.meta.requestId).toMatch(/^req_/);
  });

  it('supports custom status codes', async () => {
    const res = apiSuccess({ id: '1' }, 201);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('handles null data', async () => {
    const res = apiSuccess(null);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeNull();
  });
});

describe('apiError', () => {
  it('returns error envelope with default 400 status', async () => {
    const res = apiError('BAD_INPUT', 'Field is required');
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('BAD_INPUT');
    expect(json.error.message).toBe('Field is required');
    expect(json.error.statusCode).toBe(400);
  });

  it('supports custom status codes', async () => {
    const res = apiError('NOT_FOUND', 'Resource missing', 404);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.statusCode).toBe(404);
  });
});

describe('ERRORS', () => {
  it('UNAUTHORIZED returns 401', async () => {
    const res = ERRORS.UNAUTHORIZED();
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('FORBIDDEN returns 403', async () => {
    const res = ERRORS.FORBIDDEN();
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe('FORBIDDEN');
  });

  it('NOT_FOUND returns 404 with dynamic resource name', async () => {
    const res = ERRORS.NOT_FOUND('Workspace');
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe('WORKSPACE_NOT_FOUND');
    expect(json.error.message).toBe('Workspace not found');
  });

  it('VALIDATION returns 400 with custom message', async () => {
    const res = ERRORS.VALIDATION('templateId required');
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toBe('templateId required');
  });

  it('WORKSPACE_LIMIT returns 403', async () => {
    const res = ERRORS.WORKSPACE_LIMIT();
    expect(res.status).toBe(403);
  });

  it('ROLE_PROTECTED returns 400 with role name', async () => {
    const res = ERRORS.ROLE_PROTECTED('Orchestrator');
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('Orchestrator');
  });
});
