const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('HTPR-9076 narrow inbox tabs is a reversible bugfix under design review', () => {
  const { default: flag } = loadModule('src/lib/flags/definitions/htpr-9076-narrow-inbox-tabs.ts');
  assert.equal(flag.key, 'htpr-9076-narrow-inbox-tabs');
  assert.equal(flag.kind, 'bugfix');
  assert.equal(flag.defaultMode, 'OWNER_AND_QA');
  assert.equal(flag.releaseRisk.risk, 'small');
});

test('the inbox tab bar follows the phone signal, not a container width', () => {
  const inbox = read('src/app/inbox/Inbox.tsx');
  assert.match(inbox, /useFlag\(HTPR_9076_NARROW_INBOX_TABS_FLAG\)/, 'Inbox must read the flag');
  assert.match(inbox, /narrowLayout=\{narrowInboxTabs\}/, 'the tab bar must know the narrow layout');
  assert.match(inbox, /hidden=\{narrowInboxTabs && isMbl\}/, 'a phone still uses the dock, never the top bar');

  const tabBar = inbox.slice(inbox.indexOf('const SplitTitlesContainer'));
  assert.match(tabBar, /hidden \? "hidden" : narrowLayout \? "flex" : "hidden @md:flex"/,
    'flag on must show the tabs at the top at any column width, flag off keeps the container query');
});

test('flag off keeps the bottom tab bar that flag on removes', () => {
  const inbox = read('src/app/inbox/Inbox.tsx');
  assert.match(inbox, /\{!isMbl && !narrowInboxTabs && \(/, 'the duplicate bottom bar stays when the flag is off');
  assert.match(inbox, /inbox_footer/, 'flag off still renders the footer tab bar');
});

test('narrow rows drop their tags before the title, and never shrink a chip into letters', () => {
  const title = read('src/components/Common/TaskRowComponents/TaskTitle.tsx');
  assert.match(title, /useFlag\(HTPR_9076_NARROW_INBOX_TABS_FLAG\)/, 'the chips must read the flag');
  assert.match(title, /narrowRow && "hidden @min-\[700px\]:flex"/,
    'tags drop once the row is under 700px, flag on only');
  assert.match(title, /'shrink-0 max-w-\[120px\] overflow-hidden whitespace-nowrap'/,
    'a visible chip keeps its width instead of clipping to one letter');

  const row = read('src/components/notifications/NotificationRow.tsx');
  assert.match(row, /useFlag\(HTPR_9076_NARROW_INBOX_TABS_FLAG\)/, 'the row must read the flag');
  assert.match(row, /\$\{narrowInboxTabs \? "@container" : ""\}/, 'the row must be its own container when the flag is on');
});
