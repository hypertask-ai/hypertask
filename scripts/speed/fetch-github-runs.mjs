#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { STATE, PATHS, verifyRun } from './measure.mjs';

export function fetchGithubRuns() {
  const identity = process.env.SPEED_AGE_IDENTITY;
  if (!identity?.trim()) throw new Error('Missing speed age identity');
  fs.mkdirSync(STATE, { recursive: true, mode: 0o700 });
  // Share the measurement lock so a legacy/manual VPS run cannot lose imported history.
  const lock = path.join(STATE, 'measure.lock');
  const handle = fs.openSync(lock, 'wx', 0o600);
  let temporary;
  const historyFile = path.join(STATE, 'history.json');
  const pending = `${historyFile}.${process.pid}.tmp`;
  const env = { ...process.env };
  delete env.SPEED_AGE_IDENTITY;
  const command = (name, args) => execFileSync(name, args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  try {
    temporary = fs.mkdtempSync(path.join(STATE, 'github-'));
    const keyFile = path.join(temporary, 'identity');
    fs.writeFileSync(keyFile, identity, { mode: 0o600 });
    const history = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : [];
    if (!Array.isArray(history)) throw new Error('Invalid history');
    const known = new Set(history.filter(run => run.github).map(run => String(run.github.runId)));
    const listed = JSON.parse(command('gh', ['run', 'list', '--repo', 'hypertask-ai/hypertask', '--workflow', 'speed-live.yml', '--branch', 'production', '--status', 'success', '--limit', '100', '--json', 'databaseId,conclusion,createdAt']));
    if (!Array.isArray(listed)) throw new Error('Invalid GitHub runs');
    let added = 0;
    for (const entry of listed.filter(run => run.conclusion === 'success').sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
      if (!Number.isSafeInteger(entry.databaseId) || entry.databaseId < 1 || !Number.isFinite(Date.parse(entry.createdAt))) throw new Error('Invalid GitHub run');
      if (known.has(String(entry.databaseId))) continue;
      const download = path.join(temporary, String(entry.databaseId));
      // A green setup-skip has no artifact. Distinguish it from a failed download, which must be retried.
      const artifacts = JSON.parse(command('gh', ['api', `repos/hypertask-ai/hypertask/actions/runs/${entry.databaseId}/artifacts`, '--paginate', '--slurp']));
      if (!Array.isArray(artifacts) || artifacts.some(page => !Array.isArray(page.artifacts))) throw new Error('Invalid artifacts');
      const name = `speed-run-${entry.databaseId}`;
      if (!artifacts.some(page => page.artifacts.some(artifact => artifact.name === name && !artifact.expired))) continue;
      command('gh', ['run', 'download', String(entry.databaseId), '--repo', 'hypertask-ai/hypertask', '-n', name, '-D', download]);
      const encrypted = path.join(download, 'run.json.age');
      if (!fs.lstatSync(encrypted).isFile()) throw new Error('Invalid encrypted artifact');
      const run = JSON.parse(command('age', ['-d', '-i', keyFile, encrypted]));
      if (run.github?.runId !== entry.databaseId || !/^[a-f0-9]{40}$/.test(run.github?.sha) || run.conditions?.runner !== 'github-actions' || !Number.isInteger(run.conditions?.samples) || run.conditions.samples < 1 || run.conditions.samples > 5 || !Array.isArray(run.samples) || run.samples.length !== run.conditions.samples * PATHS.length * 2) throw new Error('Invalid GitHub measurement');
      verifyRun(run);
      history.push(run);
      known.add(String(entry.databaseId));
      added++;
    }
    if (added) {
      // Keep --latest chronological even when recovering a previously missed artifact.
      history.sort((a, b) => Date.parse(a.started) - Date.parse(b.started));
      fs.writeFileSync(pending, JSON.stringify(history, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      fs.renameSync(pending, historyFile);
    }
    return added;
  } finally {
    fs.rmSync(pending, { force: true });
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
    fs.closeSync(handle);
    fs.unlinkSync(lock);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    fetchGithubRuns();
    console.log('Speed import complete');
  } catch {
    // gh, age and JSON exceptions can contain private response data or identity material.
    console.error('Speed import failed; inspect setup and private history locally.');
    process.exitCode = 1;
  }
}
