const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluate, priorityOf, blocks, isCodex } = require('../.github/scripts/codex-review-gate.cjs');

const head = 'a'.repeat(40);
const bot = 'chatgpt-codex-connector[bot]';
const badge = level => `![P${level} Badge](https://img.shields.io/badge/P${level}-orange) Title`;
const pr = extra => ({ headOid: head, committedDate: '2026-11-08T01:00:00Z', reviews: [], comments: [], thumbsUp: async () => [], ...extra });
const review = (comments, extra) => ({ author: bot, commit: head, body: 'Codex Review', url: 'https://example.test/r/1', comments, ...extra });
const states = async extra => (await evaluate(pr(extra))).state;

test('P1 finding on the head fails, P0 is named as worst', async () => {
  assert.equal(await states({ reviews: [review([badge(1)])] }), 'failure');
  assert.match((await evaluate(pr({ reviews: [review([badge(1), badge(0)])] }))).description, /worst P0/);
});

test('a finding with no badge fails closed', async () => {
  assert.match((await evaluate(pr({ reviews: [review(['Rename this.'])] }))).description, /unrated/);
});

test('P2-only findings and findingless reviews pass', async () => {
  assert.equal(await states({ reviews: [review([badge(2)])] }), 'success');
  assert.equal(await states({ reviews: [review([])] }), 'success');
});

test('reviews of an older commit or by someone else are ignored', async () => {
  assert.equal(await states({ reviews: [review([badge(1)], { commit: 'b'.repeat(40) })] }), 'pending');
  assert.equal(await states({ reviews: [review([], { author: 'someone' })] }), 'pending');
});

test('a Codex no-issues comment counts only after the head commit', async () => {
  const comment = createdAt => [{ author: bot, body: "Didn't find any major issues.", createdAt }];
  assert.equal(await states({ comments: comment('2026-11-08T01:05:00Z') }), 'success');
  assert.equal(await states({ comments: comment('2026-11-08T00:30:00Z') }), 'pending');
});

test('a Codex thumbs-up counts only after the head commit', async () => {
  assert.equal(await states({ thumbsUp: async () => [new Date('2026-11-08T01:02:00Z')] }), 'success');
  assert.equal(await states({ thumbsUp: async () => [new Date('2026-11-08T00:59:00Z')] }), 'pending');
  assert.equal(await states({}), 'pending');
});

test('badge parsing and bot login matching', () => {
  assert.equal(priorityOf(badge(2)), 2);
  assert.equal(priorityOf('plain'), null);
  assert.deepEqual([badge(2), badge(1), 'plain'].map(blocks), [false, true, true]);
  assert.ok(isCodex('chatgpt-codex-connector') && isCodex(bot) && !isCodex('hypertask-ai-review'));
});
