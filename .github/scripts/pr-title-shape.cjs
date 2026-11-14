const PREFIXES = ['HTPR', 'HYFA', 'YPER4', 'HYCI'];
const TAGS = [
  'BUGFIX', 'FEATURE', 'IMPROVE', 'CLI/MCP/AI', 'SPEED', 'FEEDBACK',
  'DASH', 'QA', 'BOARD', 'COST', 'PLAN', 'INFRA', 'REFACTOR',
];
const shape = new RegExp(
  '^(?:' + PREFIXES.join('|') + ')-\\d+ \\[(' +
  TAGS.join('|') +
  ')\\] \\S'
);
const expected = `(${PREFIXES.join('|')})-<n> [TAG] <summary>`;
const examples = [
  'HTPR-5626 [INFRA] Move every job off GitHub-hosted runners',
  'HYFA-43 [INFRA] Add Factory acceptance routes',
  'YPER4-17 [INFRA] Step 4: rules enforced in code',
  'HYCI-27 [INFRA] Fail the run when a known-bug todo starts passing',
];

module.exports = { PREFIXES, TAGS, shape, expected, examples };
