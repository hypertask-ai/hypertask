const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluate, priorityOf, blocks, isCodex } = require('../.github/scripts/codex-review-gate.cjs');

const head = 'a'.repeat(40);
const bot = 'chatgpt-codex-connector[bot]';
const badge = level => `![P${level} Badge](https://img.shields.io/badge/P${level}-orange) Title`;
const pr = extra => ({ headOid: head, reviews: [], comments: [], ...extra });
const review = (comments, extra) => ({ author: bot, commit: head, body: 'Codex Review', url: 'https://example.test/r/1', comments, ...extra });
const stateComment = (code_review, extra) => ({
  author: bot, url: 'https://example.test/c/1', ...extra,
  body: `<!-- codex-review-state:v1 ${JSON.stringify({ code_review })} -->`,
});
const stateOf = extra => evaluate(pr(extra)).state;

test('P1 finding on the head fails and P0 is named as worst', () => {
  assert.equal(stateOf({ reviews: [review([badge(1)])] }), 'failure');
  assert.match(evaluate(pr({ reviews: [review([badge(1), badge(0)])] })).description, /worst P0/);
});

test('a finding with no badge fails closed', () => {
  assert.match(evaluate(pr({ reviews: [review(['Rename this.'])] })).description, /unrated/);
});

test('P2-only findings and findingless reviews pass', () => {
  assert.equal(stateOf({ reviews: [review([badge(2)])] }), 'success');
  assert.equal(stateOf({ reviews: [review([])] }), 'success');
});

test('reviews of an older commit or by someone else are ignored', () => {
  assert.equal(stateOf({ reviews: [review([badge(1)], { commit: 'b'.repeat(40) })] }), 'pending');
  assert.equal(stateOf({ reviews: [review([], { author: 'someone' })] }), 'pending');
});

test('a completed Codex summary with no findings passes only for the exact head', () => {
  const clean = { status: 'completed', has_any_findings: false, has_unresolved_findings: false };
  assert.equal(stateOf({ comments: [stateComment({ ...clean, commit_sha: head })] }), 'success');
  assert.equal(stateOf({ comments: [stateComment({ ...clean, commit_sha: 'b'.repeat(40) })] }), 'pending');
  assert.equal(stateOf({ comments: [stateComment({ ...clean, commit_sha: head }, { author: 'someone' })] }), 'pending');
});

test('a running or findings summary stays pending without a review', () => {
  assert.equal(stateOf({ comments: [stateComment({ commit_sha: head, status: 'running', has_any_findings: null })] }), 'pending');
  assert.equal(stateOf({ comments: [stateComment({ commit_sha: head, status: 'completed', has_any_findings: true })] }), 'pending');
  assert.equal(stateOf({}), 'pending');
});

test('badge parsing and bot login matching', () => {
  assert.equal(priorityOf(badge(2)), 2);
  assert.equal(priorityOf('plain'), null);
  assert.deepEqual([badge(2), badge(1), 'plain'].map(blocks), [false, true, true]);
  assert.ok(isCodex('chatgpt-codex-connector') && isCodex(bot) && !isCodex('hypertask-ai-review'));
});
