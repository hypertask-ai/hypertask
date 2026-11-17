const { spawnSync } = require('node:child_process');
const { mkdtempSync, readdirSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const CONTEXT = 'pstack-verifier';
const ALLOWED = new Set([
  '.github/workflows/pstack-verifier.yml',
  'scripts/pstack-verifier.mjs',
  'tests/verifier-status-guard.test.cjs',
]);
const LOCKFILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'npm-shrinkwrap.json',
]);
const quoted = `"(?:${CONTEXT})"|'(?:${CONTEXT})'`;
const value = `(?:${quoted}|${CONTEXT}(?![\\w-]))`;
const WRITE = new RegExp([
  `(?<![\\w.])context=${value}`,
  `(?<![\\w.])context\\s*:\\s*${value}`,
  `["']context["']\\s*:\\s*(?:${quoted})`,
  `(?<![\\w.])name\\s*[:=]\\s*${value}`,
  `["']name["']\\s*:\\s*(?:${quoted})`,
].join('|'));

function normalPath(file) {
  return String(file).split(path.sep).join('/');
}

function considered(file) {
  const parts = normalPath(file).split('/');
  return parts.every(Boolean) && !parts.includes('node_modules') && !LOCKFILES.has(parts.at(-1));
}

function writesVerifierContext(text) {
  WRITE.lastIndex = 0;
  return WRITE.test(String(text));
}

function offending(files) {
  return files
    .filter((file) => {
      const normal = normalPath(file.path);
      return considered(normal) && !ALLOWED.has(normal) && !String(file.text).includes('\0') && writesVerifierContext(file.text);
    })
    .map((file) => normalPath(file.path));
}

function walk(dir, root, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(absolute, root, out);
      continue;
    }
    const rel = path.relative(root, absolute).split(path.sep).join('/');
    if (!considered(rel)) continue;
    const text = readFileSync(absolute);
    if (text.includes(0)) continue;
    out.push({ path: rel, text: text.toString('utf8') });
  }
  return out;
}

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
}

function trackedAt(head) {
  const dir = mkdtempSync(path.join(tmpdir(), 'verifier-tracked-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') };
  try {
    const read = spawnSync('git', ['read-tree', head], { encoding: 'utf8', env, timeout: 30_000 });
    if (read.status !== 0) throw new Error('git read failed; verifier status writers were not verified');
    const listed = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8', env, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    if (listed.status !== 0) throw new Error('git read failed; verifier status writers were not verified');
    return listed.stdout.split('\0').filter((file) => considered(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function filesNamed(head, tracked) {
  const result = git(['grep', '-l', '-I', '-F', '-e', CONTEXT, head]);
  if (result.status === 1) return [];
  if (result.status !== 0) throw new Error('git read failed; verifier status writers were not verified');
  const prefix = `${head}:`;
  return result.stdout.split('\n').filter(Boolean)
    .map((line) => line.startsWith(prefix) ? line.slice(prefix.length) : line)
    .filter((file) => tracked.has(file));
}

function filesTouched(base, head, tracked) {
  if (!/^[a-f0-9]{40}$/.test(base ?? '')) return [];
  const result = git(['diff', '--name-only', base, head]);
  if (result.status !== 0) return [];
  return result.stdout.split('\n').filter((file) => tracked.has(file));
}

function writersAt(head, base) {
  const tracked = new Set(trackedAt(head));
  const paths = new Set([...filesNamed(head, tracked), ...filesTouched(base, head, tracked)]);
  const files = [];
  for (const file of paths) {
    const shown = git(['show', `${head}:${file}`]);
    if (shown.status !== 0) continue;
    files.push({ path: file, text: shown.stdout });
  }
  return offending(files);
}

module.exports = { ALLOWED, CONTEXT, offending, walk, writesVerifierContext, writersAt };
