import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agent, makeApp, type TestApp } from './harness.js';

let ctx: TestApp;
const admin = () => agent(ctx.app);

beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => {
  await ctx.close();
});

describe('registration bootstrap & lockdown', () => {
  it('first register creates a system admin + household', async () => {
    const a = admin();
    const res = await a.post('/api/auth/register', {
      email: 'admin@test.local',
      password: 'password123',
      displayName: 'Admin',
      householdName: 'HH1',
    });
    expect(res.status).toBe(201);
    expect(res.data.isAdmin).toBe(true);
  });

  it('registration is closed once a user exists', async () => {
    const a = admin();
    expect((await a.get('/api/auth/registration-status')).data.open).toBe(false);
    const res = await a.post('/api/auth/register', {
      email: 'sneaky@test.local',
      password: 'password123',
      displayName: 'Sneaky',
    });
    expect(res.status).toBe(403);
  });
});

describe('household creation is admin-only and only via system', () => {
  it('the old POST /household create path is gone (404)', async () => {
    const a = admin();
    await a.post('/api/auth/login', { email: 'admin@test.local', password: 'password123' });
    expect((await a.post('/api/household', { name: 'Nope' })).status).toBe(404);
  });

  it('system admin can create a household and is auto-added as its owner', async () => {
    const a = admin();
    await a.post('/api/auth/login', { email: 'admin@test.local', password: 'password123' });
    const before = (await a.get('/api/household/mine')).data.length;
    const created = await a.post('/api/system/households', { name: 'HH2' });
    expect(created.status).toBe(201);
    const mine = (await a.get('/api/household/mine')).data;
    expect(mine.length).toBe(before + 1);
    const entry = mine.find((h: any) => h.household.id === created.data.id);
    expect(entry.role).toBe('owner');
    // creating did not switch the active household
    expect((await a.get('/api/household')).data.id).not.toBe(created.data.id);
  });
});

describe('household-settings gating (owner vs member)', () => {
  let hh1Id = 0;
  let memberId = 0;

  it('admin (owner) can add a member; member is not admin', async () => {
    const a = admin();
    await a.post('/api/auth/login', { email: 'admin@test.local', password: 'password123' });
    hh1Id = (await a.get('/api/household')).data.id;
    const res = await a.post('/api/auth/add-spouse', {
      email: 'member@test.local',
      password: 'password123',
      displayName: 'Member',
    });
    expect(res.status).toBe(201);
    expect(res.data.isAdmin).toBe(false);
    memberId = res.data.id;
  });

  it('a member cannot edit household settings but can read', async () => {
    const m = agent(ctx.app);
    await m.post('/api/auth/login', { email: 'member@test.local', password: 'password123' });
    expect((await m.put('/api/household', { name: 'Hacked' })).status).toBe(403);
    expect((await m.post('/api/accounts', { name: 'x', type: 'checking', openingBalanceCents: 0 })).status).toBe(403);
    expect((await m.post('/api/categories', { groupName: 'G', name: 'C', kind: 'expense' })).status).toBe(403);
    expect((await m.get('/api/accounts')).status).toBe(200); // reads allowed
  });

  it('a member cannot reach system settings', async () => {
    const m = agent(ctx.app);
    await m.post('/api/auth/login', { email: 'member@test.local', password: 'password123' });
    expect((await m.get('/api/system/info')).status).toBe(403);
  });

  it('system admin can promote a member to household admin, who can then edit', async () => {
    const a = admin();
    await a.post('/api/auth/login', { email: 'admin@test.local', password: 'password123' });
    const promote = await a.put('/api/system/memberships', { userId: memberId, householdId: hh1Id, role: 'owner' });
    expect(promote.status).toBe(200);

    const m = agent(ctx.app);
    await m.post('/api/auth/login', { email: 'member@test.local', password: 'password123' });
    expect((await m.put('/api/household', { name: 'Renamed by HH admin' })).status).toBe(200);
  });

  it('cannot remove the last system admin', async () => {
    const a = admin();
    await a.post('/api/auth/login', { email: 'admin@test.local', password: 'password123' });
    const me = (await a.get('/api/auth/me')).data;
    const res = await a.put(`/api/system/users/${me.id}/admin`, { isAdmin: false });
    expect(res.status).toBe(400);
  });
});
