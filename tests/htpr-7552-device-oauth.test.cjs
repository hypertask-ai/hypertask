const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { NextRequest } = require('next/server');
const { fixture, ORIGIN, SECRET, CHALLENGE } = require('./helpers/device-pairing.cjs');

const REDIRECT = 'https://client.example.test/callback';

function oauthFixture() {
  process.env.SESSION_SECRET = 'device-oauth-test-only-secret';
  process.env.JWT_SECRET = 'device-oauth-test-only-secret';
  const f = fixture();
  const client = { client_id: 'test-client', client_name: 'Test MCP client', redirect_uris: [REDIRECT], grant_types: ['authorization_code'] };
  f.prisma.oAuthClient = { findUnique: async ({ where }) => where.client_id === client.client_id ? client : null, updateMany: async () => ({ count: 1 }) };
  f.prisma.oAuthClientGrant = {
    findUnique: async () => f.state.grant,
    upsert: async () => { f.state.humanGrantWrites++; f.state.grant = { id: 'human-grant' }; return f.state.grant; },
  };
  f.prisma.oAuthAuthorizationCode = {
    create: async ({ data }) => { f.state.codes.push({ ...data }); return data; },
    findUnique: async ({ where }) => {
      const row = f.state.codes.find(row => row.code === where.code);
      return row ? { ...row, user: { id: row.user_id, email: 'pairing@example.invalid', uid: 'fixture-user' } } : null;
    },
    updateMany: async ({ where, data }) => {
      const rows = f.state.codes.filter(row => row.code === where.code && row.used === where.used);
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
  };
  const paired = f.load('src/lib/auth/devicePairingOAuth.ts', { '@/lib/auth/devicePairing': f.domain });
  const auth = f.load('src/lib/mcp/auth/verifyJwt.ts', { '@/lib/auth/devicePairing': f.domain });
  const session = f.load('src/lib/auth/session.ts');
  const consent = f.load('src/lib/oauth/consent.ts');
  let activeRequest;
  const authorize = f.load('src/app/oauth/authorize/route.ts', {
    'next/headers': { cookies: async () => activeRequest.cookies },
    '@/lib/auth/devicePairingOAuth': paired,
  });
  const token = f.load('src/app/oauth/token/route.ts', {
    '@/lib/auth/devicePairingOAuth': paired,
    '@/lib/mcp/auth': auth,
  });
  const base = { response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 'opaque-client-state' };
  async function request(method, fields, flow, ownerId = 42) {
    const cookie = `${flow?.cookie ? flow.cookie + '; ' : ''}ht_session=${session.signSession({ id: ownerId })}`;
    const headers = { cookie, origin: ORIGIN, ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) };
    activeRequest = new NextRequest(`${ORIGIN}/oauth/authorize${method === 'GET' ? '?' + new URLSearchParams(fields) : ''}`, { method, headers, ...(method === 'POST' ? { body: new URLSearchParams(fields).toString() } : {}) });
    return authorize[method](activeRequest);
  }
  async function exchange(code, verifier = SECRET) {
    return token.POST(new NextRequest(`${ORIGIN}/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: verifier }).toString(),
    }));
  }
  function approval(flow, overrides = {}) {
    return { ...base, device_pairing_id: flow.id, consent_token: consent.signConsentToken({ userId: 42, clientId: client.client_id, redirectUri: REDIRECT, codeChallenge: CHALLENGE, agentId: null, devicePairingId: flow.id }), ...overrides };
  }
  async function approved() {
    const flow = await f.start();
    const response = await request('POST', approval(flow), flow);
    assert.equal(response.status, 303);
    const url = new URL(response.headers.get('location'));
    assert.equal(url.pathname, '/oauth/success');
    const target = new URL(url.searchParams.get('redirect_uri'));
    assert.equal(target.origin, new URL(REDIRECT).origin);
    assert.equal(target.searchParams.get('state'), base.state);
    return { ...flow, code: target.searchParams.get('code') };
  }
  return { ...f, deviceRequest: f.request, auth, paired, base, request, exchange, approval, approved };
}

test('standard OAuth pairing issues an agent-only credential and first authenticated use connects', async () => {
  const f = oauthFixture(); const flow = await f.approved();
  assert.equal(f.state.humanGrantWrites, 0);
  assert.equal(f.state.codes[0].devicePairingId, flow.id);
  assert.equal(f.state.codes[0].agent_id, f.state.agents[0].id);
  assert.ok(f.state.codes[0].expires_at <= f.state.flows[0].expiresAt);
  const result = await f.exchange(flow.code);
  assert.equal(result.status, 200, await result.clone().text());
  const issued = await result.json();
  assert.equal(issued.token_type, 'Bearer');
  assert.equal(f.state.flows[0].state, 'DELIVERED');
  assert.equal((await f.exchange(flow.code, 'x'.repeat(43))).status, 400);
  assert.deepEqual(await (await f.exchange(flow.code)).json(), issued);
  f.state.flows[0].expiresAt = new Date(Date.now() - 1);
  const identity = await f.auth.validateJwtToken(issued.access_token, { boundedLogging: true });
  assert.equal(identity.agentId, f.state.agents[0].id);
  assert.equal(f.state.flows[0].state, 'CONNECTED');
  assert.equal(f.state.flows[0].deliveryResult, null);
  assert.equal(f.state.agents[0].devicePairingId, null);
});

test('paired consent never creates human-wide consent and existing independent grants remain usable', async () => {
  const f = oauthFixture(); const flow = await f.approved();
  const ordinary = await f.request('GET', f.base, flow);
  assert.equal(new URL(ordinary.headers.get('location')).pathname, '/oauth/consent');
  assert.equal(f.state.codes.length, 1);
  f.state.grant = { id: 'separately-approved-human-grant' };
  const allowed = await f.request('GET', f.base, flow);
  const allowedUrl = new URL(allowed.headers.get('location'));
  const allowedTarget = allowedUrl.pathname === '/oauth/success' ? new URL(allowedUrl.searchParams.get('redirect_uri')) : allowedUrl;
  assert.equal(allowedTarget.origin, new URL(REDIRECT).origin);
  assert.equal(f.state.codes[1].agent_id, null);
  assert.equal(f.state.codes[1].devicePairingId, undefined);
  const pending = await f.start();
  const explicit = await f.request('GET', f.base, pending);
  assert.equal(new URL(explicit.headers.get('location')).pathname, '/oauth/consent');
  assert.equal(f.state.codes.length, 2);
});

test('paired consent binds the exact flow, human browser, OAuth client and PKCE challenge', async () => {
  for (const mutation of ['flow', 'browser', 'challenge', 'human']) {
    const f = oauthFixture(); const flow = await f.start();
    const fields = f.approval(flow);
    let browser = flow; let ownerId = 42;
    if (mutation === 'flow') fields.device_pairing_id = randomUUID();
    if (mutation === 'browser') browser = { ...flow, cookie: '__Host-ht-device-pairing=' + 'x'.repeat(43) };
    if (mutation === 'challenge') fields.code_challenge = 'x'.repeat(43);
    if (mutation === 'human') ownerId = 7;
    const response = await f.request('POST', fields, browser, ownerId);
    assert.notEqual(new URL(response.headers.get('location') ?? ORIGIN).origin, new URL(REDIRECT).origin);
    assert.equal(f.state.codes.length, 0);
    assert.equal(f.state.agents.length, 0);
    assert.equal(f.state.humanGrantWrites, 0);
  }
});

test('OAuth delivery shares the original deadline, cancellation and rollout gate with code login', async () => {
  for (const failure of ['expired', 'denied', 'off']) {
    const f = oauthFixture(); const flow = await f.approved();
    if (failure === 'expired') f.state.flows[0].expiresAt = new Date(Date.now() - 1);
    if (failure === 'denied') assert.equal((await f.deviceRequest('deny', { id: flow.id }, flow)).status, 200);
    if (failure === 'off') f.state.flags = false;
    const response = await f.exchange(flow.code);
    assert.equal(response.status, 400);
    assert.equal(f.state.codes[0].used, false);
    assert.equal((await response.json()).access_token, undefined);
    if (failure === 'off') {
      f.state.flags = true;
      assert.equal((await f.exchange(flow.code)).status, 200);
    }
  }
});
