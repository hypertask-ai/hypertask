const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('HTPR-8413 board team id is a small reversible improvement for everyone', () => {
  const { default: flag } = loadModule('src/lib/flags/definitions/htpr-8413-board-team-id.ts');
  assert.equal(flag.key, 'htpr-8413-board-team-id');
  assert.equal(flag.kind, 'improvement');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.releaseRisk.risk, 'small');
  assert.equal(flag.releaseRisk.highRisk, undefined);
});

test('the board read gates the team id on the switch', () => {
  const source = read('src/lib/mcp/operations/projects/operation.ts');
  assert.match(source, /isFeatureEnabled\(HTPR_8413_BOARD_TEAM_FLAG, user\.id\)/);
  assert.match(source, /if \(showTeamId\) row\.teamId = project\.teamId \?\? null/);
});
