const { assert, path, root, jiti, test } = require('./helpers/compose-task-palette-fixture.cjs');

test('HTPR-8943 flag is an improvement that defaults to Everyone', () => {
  const { default: flag, HTPR_8943_CTRLK_TABS_ON_TOP_FLAG: key } = jiti(path.join(root, 'src/lib/flags/definitions/htpr-8943-ctrlk-tabs-on-top.ts'));
  assert.equal(key, 'htpr-8943-ctrlk-tabs-on-top');
  assert.equal(flag.key, key);
  assert.equal(flag.kind, 'improvement');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.releaseRisk.risk, 'small');
});
