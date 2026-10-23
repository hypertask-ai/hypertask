const assert = require('node:assert/strict');
const test = require('node:test');
require('tsx/cjs');
const { isStaleInboxHydration } = require('../src/lib/inboxSync/hydrationStaleness.ts');
const flag = require('../src/lib/flags/definitions/htpr-7690-inbox-hydration-floor.ts').default;

const revision = (time) => `${String(time).padStart(16, '0')}:tab-a`;
const beforeArchive = revision(1_000);
const archive = revision(2_000);
const reloadRequest = revision(3_000);

const reloadAfterArchive = (overrides = {}) => isStaleInboxHydration({
  payloadRevision: beforeArchive,
  observedRevision: reloadRequest,
  networkRequestRevision: reloadRequest,
  floorBeforeNetworkRequest: archive,
  queryRevision: null,
  keepFloorBeforeNetworkRequest: true,
  ...overrides,
});

test('a saved Inbox copy from before an archive is refused after a reload that already started its own request', () => {
  assert.equal(reloadAfterArchive(), true);
});

test('with the flag off the old check still lets that saved copy through', () => {
  assert.equal(reloadAfterArchive({ keepFloorBeforeNetworkRequest: false }), false);
});

test('a saved copy as new as everything before the reload still shows first', () => {
  assert.equal(reloadAfterArchive({ payloadRevision: archive }), false);
  assert.equal(reloadAfterArchive({ floorBeforeNetworkRequest: null }), false);
});

test('a newer revision from another tab or the query cache still refuses an older saved copy', () => {
  assert.equal(reloadAfterArchive({ observedRevision: revision(4_000), floorBeforeNetworkRequest: null }), true);
  assert.equal(reloadAfterArchive({ floorBeforeNetworkRequest: null, queryRevision: archive }), true);
});

test('the bugfix flag is on for everyone by default', () => {
  assert.equal(flag.key, 'htpr-7690-inbox-hydration-floor');
  assert.equal(flag.kind, 'bugfix');
  assert.equal(flag.defaultMode, 'EVERYONE');
});
