#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const retired = '.claude/skills/verify-qa/reference';
const archive = `${retired}/archive`;

function markdownFiles(directory) {
  const full = path.join(root(), directory);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'archive' ? [] : markdownFiles(name);
    return entry.name.endsWith('.md') ? [name] : [];
  });
}

function root() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function checkArchive() {
  const problems = [];
  for (const name of ['midscene-flows.md', 'e2b-fleet.md']) {
    if (existsSync(path.join(root(), retired, name))) problems.push(`${retired}/${name} still sits in the active reference folder`);
    if (!existsSync(path.join(root(), archive, name))) problems.push(`${archive}/${name} is missing`);
  }
  if (!existsSync(path.join(root(), archive, 'README.md'))) problems.push(`${archive}/README.md is missing`);
  for (const file of markdownFiles(retired)) {
    const text = readFileSync(path.join(root(), file), 'utf8');
    if (/midscene-flows\.md|e2b-fleet\.md/.test(text) && !text.includes('archive/')) problems.push(`${file} links a retired page without the archive path`);
  }
  return problems;
}

function checkE2eReadme() {
  const file = 'e2e/midscene/README.md';
  if (!existsSync(path.join(root(), file))) return [];
  return readFileSync(path.join(root(), file), 'utf8').startsWith('# Midscene flows — retired')
    ? []
    : [`${file} still presents Midscene as current`];
}

function checkRecipe() {
  const file = '.claude/skills/verify-qa/reference/local-launch.md';
  const text = readFileSync(path.join(root(), file), 'utf8');
  const problems = [];
  if (!text.includes('# Local launch and teardown')) problems.push(`${file} has no local launch and teardown section`);
  for (const needle of ['docker run', 'DATABASE_URL=', 'prisma migrate deploy', 'docker rm -f']) {
    if (!text.includes(needle)) problems.push(`${file} local recipe misses ${needle}`);
  }
  return problems;
}

if (process.argv.includes('--recipe')) {
  const problems = checkRecipe();
  if (problems.length) process.stdout.write(`${problems.map(problem => `- ${problem}`).join('\n')}\n`);
  else process.stdout.write('local recipe ok\n');
  process.exitCode = problems.length ? 1 : 0;
} else {
  const problems = [...checkArchive(), ...checkE2eReadme()];
  if (problems.length) process.stdout.write(`${problems.map(problem => `- ${problem}`).join('\n')}\n`);
  else process.stdout.write('retired docs ok\n');
  process.exitCode = problems.length ? 1 : 0;
}
