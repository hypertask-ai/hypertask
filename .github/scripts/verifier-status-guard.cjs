const { spawnSync } = require('node:child_process');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

const CONTEXT = 'pstack-verifier';
const ALLOWED = new Set([
  '.github/workflows/pstack-verifier.yml',
  'scripts/pstack-verifier.mjs',
]);
const EXTENSIONS = new Set(['.yml', '.yaml', '.mjs', '.cjs', '.js', '.sh', '.py']);
const quoted = `"(?:${CONTEXT})"|'(?:${CONTEXT})'`;
const value = `(?:${quoted}|${CONTEXT}(?![\\w-]))`;
const WRITE = new RegExp([
  `(?<![\\w.])context=${value}`,
  `(?<![\\w.])context\\s*:\\s*${value}`,
  `["']context["']\\s*:\\s*(?:${quoted})`,
  `(?<![\\w.])name\\s*[:=]\\s*${value}`,
  `["']name["']\\s*:\\s*(?:${quoted})`,
].join('|'));

function scanned(file) {
  const normal = String(file).split(path.sep).join('/');
  return normal.startsWith('.github/') && !normal.includes('/node_modules/') && EXTENSIONS.has(path.posix.extname(normal));
}

function writesVerifierContext(text) {
  WRITE.lastIndex = 0;
  return WRITE.test(String(text));
}

function offending(files) {
  return files
    .filter((file) => scanned(file.path) && !ALLOWED.has(file.path.split(path.sep).join('/')) && writesVerifierContext(file.text))
    .map((file) => file.path.split(path.sep).join('/'));
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
    if (!scanned(rel)) continue;
    out.push({ path: rel, text: readFileSync(absolute, 'utf8') });
  }
  return out;
}

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
}

function filesNamed(head) {
  const result = git(['grep', '-l', '-F', '-e', CONTEXT, head, '--', '.github']);
  if (result.status === 1) return [];
  if (result.status !== 0) throw new Error('git read failed; verifier status writers were not verified');
  const prefix = `${head}:`;
  return result.stdout.split('\n').filter(Boolean).map((line) => line.startsWith(prefix) ? line.slice(prefix.length) : line);
}

function filesTouched(base, head) {
  if (!/^[a-f0-9]{40}$/.test(base ?? '')) return [];
  const result = git(['diff', '--name-only', base, head, '--', '.github']);
  if (result.status !== 0) return [];
  return result.stdout.split('\n').filter(Boolean);
}

function writersAt(head, base) {
  const paths = new Set([...filesNamed(head), ...filesTouched(base, head)].filter(scanned));
  const files = [];
  for (const file of paths) {
    const shown = git(['show', `${head}:${file}`]);
    if (shown.status !== 0) continue;
    files.push({ path: file, text: shown.stdout });
  }
  return offending(files);
}

module.exports = { ALLOWED, CONTEXT, offending, walk, writesVerifierContext, writersAt };
