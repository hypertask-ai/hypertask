import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./qa-login', import.meta.url));
const skill = fileURLToPath(new URL('../SKILL.md', import.meta.url));
const accounts = [
  ['flags', 985, '.config/hypertask-videos/storageState-qa.json'],
  ['plain', 2343, '.config/hypertask-videos/storageState-qa-normal.json'],
  ['free', 3411, '.config/ht-qa/state-free.json'],
  ['byok', 3412, '.config/ht-qa/state-byok.json'],
  ['pro', 3413, '.config/ht-qa/state-pro.json'],
  ['owner', 4036, '.config/ht-qa/state-owner.json'],
  ['member', 4037, '.config/ht-qa/state-member.json'],
];

for (const [account, userId, path] of accounts) {
  test(`${account} selects the designated identity without reading credentials`, () => {
    const result = JSON.parse(execFileSync(process.execPath, [script, account], { encoding: 'utf8' }));
    assert.equal(result.account, account);
    assert.equal(result.userId, userId);
    assert.equal(result.stateFile, resolve(homedir(), path));
    assert.equal(execFileSync(process.execPath, [script, account, '--state'], { encoding: 'utf8' }).trim(), result.stateFile);
    assert.equal(result.refresh, account === 'flags' ? '/qa/login' : 'hypertask-qa-runner/scripts/login.mjs');
  });
}

test('default selects flag QA, guest selects no state', () => {
  assert.equal(JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' })).userId, 985);
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, [script, 'guest'], { encoding: 'utf8' })), {
    account: 'guest', userId: null, stateFile: null, refresh: null,
  });
  assert.notEqual(spawnSync(process.execPath, [script, 'guest', '--state']).status, 0);
});

for (const args of [['admin'], ['6'], ['unknown'], ['flags', '--unexpected'], ['flags', '--state', 'extra']]) {
  test(`refuses unsupported selection ${args.join(' ')}`, () => {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /usage: qa-login/);
  });
}

test('QA skill stays under 500 words with working local references', () => {
  const text = readFileSync(skill, 'utf8');
  const count = text.trim().split(/\s+/).length;
  assert.ok(count < 500, `QA skill contains ${count} words`);
  assert.doesNotMatch(text, /Disposable local PR build|premerge-local\.sh|2026-\d\d-\d\d/);
  for (const [, path] of text.matchAll(/\]\(([^:)]+)\)/g)) {
    assert.ok(existsSync(resolve(skill, '..', path)), `missing reference ${path}`);
  }
});
