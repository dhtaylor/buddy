import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './harness.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => {
  await ctx.close();
});

describe('GET /health', () => {
  it('returns 200 with no session cookie (unauthenticated liveness check)', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
