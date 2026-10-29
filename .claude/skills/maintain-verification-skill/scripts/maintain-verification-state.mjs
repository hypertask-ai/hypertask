#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { mapPath, repoPaths, checkFeatureMap, formatProblems } from './feature-map-check.mjs';

const [action, repo, state, run, forced = ''] = process.argv.slice(2);
const read = file => readFileSync(file, 'utf8');
const json = file => JSON.parse(read(file));
const save = (file, value) => {
  writeFileSync(file + '.tmp', value);
  renameSync(file + '.tmp', file);
};
const git = args => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const html = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function answer(file) {
  const value = json(file);
  if (typeof value.summary !== 'string' || !value.summary.trim() || !Array.isArray(value.entryPoints) || !value.entryPoints.length || !value.entryPoints.every(item => typeof item === 'string' && /\S+:\d+/.test(item)) || typeof value.liveRecipe !== 'string' || !value.liveRecipe.trim()) throw new Error('incomplete source answer');
  if (value.drift !== 'none' && (!Array.isArray(value.drift) || !value.drift.length || !value.drift.every(item => typeof item === 'string' && /\S+:\d+/.test(item)))) throw new Error('drift needs citations or none');
  return value;
}

if (action === 'plan') {
  const pages = [mapPath, '.claude/skills/verify-qa/reference/ops-map'].flatMap(directory =>
    existsSync(path.join(repo, directory)) ? readdirSync(path.join(repo, directory))
      .filter(name => name.endsWith('.md') && name !== 'INDEX.md').sort()
      .map(name => path.relative(mapPath, path.join(directory, name)).split(path.sep).join('/')) : []);
  const sha = git(['rev-parse', 'HEAD']);
  const previous = existsSync(path.join(state, 'last-run-sha')) ? read(path.join(state, 'last-run-sha')).trim() : '';
  let changed;
  if (previous) {
    try {
      changed = git(['diff', '--no-renames', '--name-only', '-z', previous, sha]).split('\0').filter(Boolean);
    } catch {
      console.log('maintain-verification: previous SHA unavailable; queueing all pages');
    }
  }
  const pendingFile = path.join(state, 'pending.json');
  const pending = existsSync(pendingFile) ? json(pendingFile).filter(page => pages.includes(page)) : [];
  const affected = pages.filter(page => !changed || changed.includes(path.posix.join(mapPath, page)) || repoPaths(read(path.join(repo, mapPath, page))).some(cited => changed.some(file => file === cited || file.startsWith(cited.replace(/\/$/, '') + '/'))));
  const problems = checkFeatureMap(repo);
  const queue = [...new Set([...pending, ...affected])];
  const requested = forced ? [...new Set(forced.split(','))] : queue;
  if (requested.some(page => !pages.includes(page))) throw new Error('--pages must name existing customer or ../ops-map/ recipes');
  const picked = requested.slice(0, 8);
  const skipped = [...new Set([...requested.slice(8), ...queue.filter(page => !picked.includes(page))])];
  writeFileSync(path.join(run, 'plan.json'), JSON.stringify({ sha, picked, skipped, problems }, null, 2) + '\n');
  writeFileSync(path.join(run, 'picked'), picked.join('\n') + (picked.length ? '\n' : ''));
  writeFileSync(path.join(run, 'checker.md'), formatProblems(problems));
  for (const page of skipped) console.log(`maintain-verification: skipped to next run: ${page}`);
} else if (action === 'validate') {
  answer(path.join(run, forced.replaceAll('/', '_') + '.json'));
} else if (action === 'report') {
  const plan = json(path.join(run, 'plan.json'));
  const drift = new Map();
  const failures = [];
  for (const page of plan.picked) {
    try {
      const value = answer(path.join(run, page.replaceAll('/', '_') + '.json'));
      if (value.drift !== 'none') drift.set(page, { citations: value.drift, recipe: value.liveRecipe, summary: value.summary, entryPoints: value.entryPoints });
    } catch {
      failures.push(page);
    }
  }
  for (const problem of plan.problems) {
    const citationFile = path.join(repo, mapPath, problem.page);
    const lines = existsSync(citationFile) ? read(citationFile).split('\n') : [];
    const line = Math.max(1, lines.findIndex(text => text.includes(problem.value)) + 1);
    const citation = `${mapPath}/${problem.page}:${line}: ${problem.kind}: ${problem.value}`;
    if (drift.has(problem.page)) {
      drift.get(problem.page).citations.push(citation);
      continue;
    }
    let recipe = 'Doctor first with verify-qa; check index links against sibling pages. No app clicks for index-only drift.';
    if (path.basename(problem.page) !== 'INDEX.md') {
      const markdown = read(path.join(repo, mapPath, problem.page));
      const drive = markdown.match(/## How to drive it\s+([\s\S]*?)(?=\n## |$)/)?.[1]?.trim();
      recipe = `Doctor first with verify-qa, then follow ${mapPath}/${problem.page}: ${drive || 'open the area using its documented customer entry point; verify the cited surface, reload and collect proof; clean up only your fixtures.'}`;
    }
    drift.set(problem.page, { citations: [citation], recipe });
  }
  const list = values => `<ul>${values.map(value => `<li>${html(value)}</li>`).join('')}</ul>`;
  let description = `<p>Source-only feature-map audit at ${html(plan.sha)}. No unattended live drive was performed.</p>`;
  for (const [page, value] of drift) {
    description += `<h2>${html(page)}</h2>`;
    if (value.summary) description += `<p>${html(value.summary)}</p><p>Source entry points</p>${list(value.entryPoints)}`;
    description += list(value.citations) + `<p><strong>Live recipe:</strong> ${html(value.recipe)}</p>`;
  }
  description += '<h2>Checker problems</h2>' + list(plan.problems.map(({ page, kind, value }) => `${page}: ${kind}: ${value}`));
  description += '<h2>Skipped to next run</h2>' + list([...new Set([...plan.skipped, ...failures])]);
  if (failures.length) description += '<p>Blocked source helpers (after one retry):</p>' + list(failures);
  description += '<p>A runner picks this ticket with /ship, fixes only the verify-qa skill directory and its feature map, and does each listed live recipe with verify-qa. Report product regressions separately; never paper them over in the map. Reconcile citations and overlapping recipes before editing.</p>\n';
  writeFileSync(path.join(run, 'description.html'), description);
  writeFileSync(path.join(run, 'result.json'), JSON.stringify({ count: drift.size, driftPages: [...drift.keys()].filter(page => page !== 'INDEX.md'), failures }, null, 2) + '\n');
} else if (action === 'finish') {
  const plan = json(path.join(run, 'plan.json'));
  const result = json(path.join(run, 'result.json'));
  save(path.join(state, 'pending.json'), JSON.stringify([...new Set([...plan.skipped, ...result.failures, ...(forced === 'true' ? result.driftPages : [])])]) + '\n');
  save(path.join(state, 'last-run-sha'), plan.sha + '\n');
} else {
  throw new Error('unknown state action');
}
