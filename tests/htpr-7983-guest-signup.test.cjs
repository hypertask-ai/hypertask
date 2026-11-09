const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');

const { guestAutoOpenAllowed } = loadModule('src/lib/aiChat/guestAutoOpen.ts');
const { guestSignupLandingUrl } = loadModule('src/lib/demo/guestSignupLanding.ts');

const guest = { id: 900, uid: 'guest_abc' };
const member = { id: 6, uid: 'email_abc' };
const board = { enabled: true, user: guest, page: 'aiChatOpenBoards', mobile: false };

test('a guest free board opens the chat on desktop when the flag is on', () => {
  assert.equal(guestAutoOpenAllowed(board), true);
});

test('the same board keeps the chat closed when the flag is off', () => {
  assert.equal(guestAutoOpenAllowed({ ...board, enabled: false }), false);
});

test('a signed-in account keeps its own saved chat choice', () => {
  assert.equal(guestAutoOpenAllowed({ ...board, user: member }), false);
  assert.equal(guestAutoOpenAllowed({ ...board, user: null }), false);
});

test('a phone keeps the board visible instead of opening the chat sheet', () => {
  assert.equal(guestAutoOpenAllowed({ ...board, mobile: true }), false);
});

test('ticket pages and unrecorded pages never open the board chat', () => {
  assert.equal(guestAutoOpenAllowed({ ...board, page: 'aiChatOpenTickets' }), false);
  assert.equal(guestAutoOpenAllowed({ ...board, page: 'aiChatOpenNewTickets' }), false);
  assert.equal(guestAutoOpenAllowed({ ...board, page: null }), false);
});

test('signup lands on the same board with the chat open', () => {
  assert.equal(guestSignupLandingUrl('/project?id=12372'), '/project?id=12372&welcome_ai=1');
  assert.equal(guestSignupLandingUrl('/project?id=12372&view=default'), '/project?id=12372&view=default&welcome_ai=1');
});

test('signup keeps onboarding and refuses an external redirect', () => {
  assert.equal(guestSignupLandingUrl('/onboarding?projectId=12372'), '/onboarding?projectId=12372');
  assert.equal(guestSignupLandingUrl('https://evil.test/project'), '/');
  assert.equal(guestSignupLandingUrl(undefined), '/');
});
