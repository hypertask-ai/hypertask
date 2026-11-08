const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluate, priorityOf, blocks, isCodex } = require('../.github/scripts/codex-review-gate.cjs');

const head = 'a'.repeat(40);
const older = 'b'.repeat(40);
const committedDate = '2026-11-08T01:00:00Z';
const bot = 'chatgpt-codex-connector[bot]';
const badge = level => `**<sub><sub>![P${level} Badge](https://img.shields.io/badge/P${level}-orange?style=flat)</sub></sub>  Title**\n\nDetails.`;
const pr = (overrides = {}) => ({
  headOid: head,
  committedDate,
  reviews: [],
  comments: [],
  thumbsUp: async () => [],
  ...overrides,
});
const review = (comments, extra = {}) => ({ author: bot, commit: head, body: 'Codex Review: Here are some suggestions.', url: 'https://github.com/o/r/pull/1#pullrequestreview-1', comments, ...extra });

test('a Codex review of the head with a P1 finding fails the gate', async () => {
  const result = await evaluate(pr({ reviews: [review([badge(1)])] }));
  assert.equal(result.state, 'failure');
  assert.match(result.description, /worst P1/);
});

test('P0 outranks P1 in the description', async () => {
  const result = await evaluate(pr({ reviews: [review([badge(1), badge(0)])] }));
  assert.match(result.description, /worst P0/);
});

test('a finding with no priority badge fails closed', async () => {
  const result = await evaluate(pr({ reviews: [review(['Please rename this.'])] }));
  assert.equal(result.state, 'failure');
  assert.match(result.description, /unrated/);
});

test('a Codex review of the head with only lower-priority findings passes', async () => {
  const result = await evaluate(pr({ reviews: [review([badge(2)])] }));
  assert.equal(result.state, 'success');
  assert.equal(result.evidence, 'https://github.com/o/r/pull/1#pullrequestreview-1');
});

test('a Codex review with no inline findings passes', async () => {
  assert.equal((await evaluate(pr({ reviews: [review([])] }))).state, 'success');
});

test('a review of an older commit says nothing about the current head', async () => {
  const result = await evaluate(pr({ reviews: [review([badge(1)], { commit: older })] }));
  assert.equal(result.state, 'pending');
});

test('a review by someone other than Codex is ignored', async () => {
  const result = await evaluate(pr({ reviews: [review([], { author: 'someone' })] }));
  assert.equal(result.state, 'pending');
});

test('a no-issues comment from Codex after the head commit passes', async () => {
  const comments = [{ author: bot, body: "Codex Review: Didn't find any major issues. Nice work!", createdAt: '2026-11-08T01:05:00Z' }];
  assert.equal((await evaluate(pr({ comments }))).state, 'success');
});

test('a no-issues comment from before the head commit does not count', async () => {
  const comments = [{ author: bot, body: "Didn't find any major issues.", createdAt: '2026-11-08T00:30:00Z' }];
  assert.equal((await evaluate(pr({ comments }))).state, 'pending');
});

test('a thumbs-up from Codex after the head commit passes', async () => {
  const result = await evaluate(pr({ thumbsUp: async () => [new Date('2026-11-08T01:02:00Z')] }));
  assert.equal(result.state, 'success');
});

test('a thumbs-up from before the head commit does not count', async () => {
  const result = await evaluate(pr({ thumbsUp: async () => [new Date('2026-11-08T00:59:00Z')] }));
  assert.equal(result.state, 'pending');
});

test('no Codex signal at all stays pending', async () => {
  assert.equal((await evaluate(pr())).state, 'pending');
});

test('badge parsing finds the highest priority and treats a badge-free body as unrated', () => {
  assert.equal(priorityOf(badge(2)), 2);
  assert.equal(priorityOf('plain'), null);
  assert.equal(blocks(badge(2)), false);
  assert.equal(blocks(badge(1)), true);
  assert.equal(blocks('plain'), true);
});

test('the bot login matches with or without the bot suffix', () => {
  assert.ok(isCodex('chatgpt-codex-connector'));
  assert.ok(isCodex(bot));
  assert.ok(!isCodex('hypertask-ai-review'));
});
