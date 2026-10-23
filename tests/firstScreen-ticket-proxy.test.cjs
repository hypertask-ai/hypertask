const assert = require('node:assert/strict');
const test = require('node:test');
const { NextRequest } = require('next/server');
const { load } = require('./task-route-loader.cjs');
const user = { id: 985, UserSetting: { onboardingTourStatus: true } };
const proxy = load('src/proxy.ts', {
  './utils/edgeHelpers': { isValidUser: () => ({ isValid: true, user }) },
  './utils/serverActions': { isMobileDevice: () => false },
  './utils/helperFunctions/helperFunctions': { canAccessTrialPage: () => true },
  '@/lib/auth/sessionEdge': { verifySessionEdge: async () => ({ id: user.id }) },
  '@/lib/auth/sessionRevocation': { isSessionTokenRevoked: async () => false },
  '@/lib/auth/cookieIdentity': {},
  '@/lib/telemetry/signupAnalytics': { recordServerCapture() {} },
}).default;
const routeHeaders = ['x-ht-board-document-route', 'x-ht-inbox-document-route', 'x-ht-ticket-document-route'];
async function request(route, destination = 'document', rsc = false) {
  const headers = { ...Object.fromEntries(routeHeaders.map(key => [key, '/detail/project-6/1'])), cookie: 'nookies_user=fixture; ht_session=fixture' };
  if (destination) headers['sec-fetch-dest'] = destination;
  if (rsc) headers.rsc = '1';
  return proxy(new NextRequest(`https://app.hypertask.ai${route}`, { headers }));
}
function forwarded(response, key) { return response.headers.get(`x-middleware-request-${key}`); }
function noStore(response) {
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  for (const name of ['CDN-Cache-Control', 'Vercel-CDN-Cache-Control']) assert.equal(response.headers.get(name), 'no-store');
}

test('document-only numeric, prefixed and catch-all ticket routes overwrite spoofed headers and disable shared caching', async () => {
  for (const route of ['/detail/project-8190/26?hash=comment', '/detail/project-15/HTPR-7627', '/detail/project-15/htpr-7627/', '/detail/project-15/7627/comment']) {
    const response = await request(route);
    assert.equal(response.headers.get('x-middleware-next'), '1');
    assert.equal(forwarded(response, 'x-ht-ticket-document-route'), route);
    assert.equal(forwarded(response, 'x-ht-board-document-route'), null);
    assert.equal(forwarded(response, 'x-ht-inbox-document-route'), null);
    noStore(response);
  }
});

test('SPA/Flight/prefetch loads delete forged route headers and never set a ticket document header', async () => {
  for (const destination of ['empty', 'iframe', undefined]) {
    const response = await request('/detail/project-8190/26', destination ?? '', true);
    for (const key of routeHeaders) assert.equal(forwarded(response, key), null);
    noStore(response);
  }
});

test('non-ticket paths, including dotted bypass paths, cannot forward a forged ticket seed route', async () => {
  for (const route of ['/settings', '/share/project-15/7627', '/detail/project-15/no-ticket', '/assets/file.js', '/detail/project-15/26.json']) {
    const response = await request(route);
    assert.equal(forwarded(response, 'x-ht-ticket-document-route'), null, route);
    assert.equal(response.headers.get('x-middleware-request-x-ht-board-document-route'), null);
  }
});

test('board and inbox document loads are still allowed with their own headers and unchanged private caching', async () => {
  for (const [route, key] of [['/project?id=15', routeHeaders[0]], ['/inbox?split=All', routeHeaders[1]]]) {
    const response = await request(route);
    assert.equal(response.headers.get('x-middleware-next'), '1');
    assert.equal(forwarded(response, key), route);
    for (const other of routeHeaders.filter(header => header !== key)) assert.equal(forwarded(response, other), null);
    noStore(response);
    const flight = await request(route, 'empty', true);
    for (const header of routeHeaders) assert.equal(forwarded(flight, header), null);
    noStore(flight);
  }
});
