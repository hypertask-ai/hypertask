#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const policy = require('./pr-size-policy.json');
const { shape, expected, TAGS, examples } = require('./pr-title-shape.cjs');

const SPLIT = 'Split it into smaller changes that each build green.';

const excluded = (filename) => policy.excludedFiles.includes(filename) ||
  policy.excludedDirectories.some((directory) => filename.startsWith(directory)) ||
  policy.excludedSuffixes.some((suffix) => filename.endsWith(suffix));

function renameNames(path) {
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path);
  if (braced) return [`${braced[1]}${braced[2]}${braced[4]}`, `${braced[1]}${braced[3]}${braced[4]}`];
  const plain = /^(.*) => (.*)$/.exec(path);
  return plain ? [plain[1], plain[2]] : [path];
}

function parseNumstat(text) {
  return text.split('\n').filter(Boolean).map((line) => {
    const [additions, deletions, ...rest] = line.split('\t');
    const path = rest.join('\t');
    if (!path) throw new Error(`Unreadable git diff line: ${line}`);
    const filenames = renameNames(path);
    const lines = (value) => (value === '-' ? 0 : Number(value));
    return { filenames, lines: lines(additions) + lines(deletions) };
  });
}

function countHandWritten(changes) {
  let counted = 0;
  let ignored = 0;
  for (const change of changes) {
    if (!change.filenames.every(Boolean) || !Number.isSafeInteger(change.lines) || change.lines < 0) {
      throw new Error('Invalid line counts from git diff; no trustworthy size count.');
    }
    if (change.filenames.every(excluded)) ignored += change.lines;
    else counted += change.lines;
  }
  return { counted, ignored, cap: policy.cap, overCap: counted > policy.cap };
}

function titleProblem(title) {
  if (shape.test(title)) return null;
  return [
    'PR title does not match the required shape.',
    '',
    `  got:      ${title}`,
    `  expected: ${expected}`,
    '',
    `Valid tags: ${TAGS.join(', ')}`,
    '',
    ...examples.map((example, index) => `${index === 0 ? 'Example: ' : '         '}${example}`),
    '',
    'A title with no ticket and tag is refused before opening.',
  ].join('\n');
}

function diffNumstat(base, cwd) {
  return execFileSync(
    'git',
    ['diff', '--numstat', '-M', '--no-ext-diff', '--diff-filter=ADMR', `${base}...HEAD`],
    { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

function preflight({ title, base, allowOverCap, cwd = process.cwd() }) {
  const problem = titleProblem(title);
  if (problem) return { ok: false, output: problem };

  let size;
  try {
    size = countHandWritten(parseNumstat(diffNumstat(base, cwd)));
  } catch (error) {
    return {
      ok: false,
      output: `PR size could not be measured against ${base}: ${error.message}\n` +
        `Do this next: fetch the base branch, then run this again.`,
    };
  }

  const summary = `PR preflight OK: title matches ${expected}; ${size.counted} hand-written ` +
    `lines (cap ${size.cap}, ${size.ignored} generated or fixture lines skipped).`;
  if (!size.overCap) return { ok: true, output: summary };
  if (allowOverCap) {
    return { ok: true, output: `${summary}\nPR size exception recorded: ${allowOverCap}` };
  }
  return {
    ok: false,
    output: `PR size: ${size.counted} hand-written lines is over the ${size.cap}-line cap. ${SPLIT}`,
  };
}

function parseArgs(argv) {
  const options = { title: '', base: 'origin/production', allowOverCap: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--title') { options.title = value ?? ''; index += 1; }
    else if (flag === '--base') { options.base = value ?? ''; index += 1; }
    else if (flag === '--allow-over-cap') { options.allowOverCap = value ?? ''; index += 1; }
    else if (flag === '--help' || flag === '-h') throw new Error('--title and --base are the accepted flags.');
    else throw new Error(`pr-preflight does not know the argument '${flag}'.`);
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  if (!options.title) throw new Error('--title is required.');
  if (!options.base) throw new Error('--base must name the branch the PR targets.');
  const result = preflight(options);
  const stream = result.ok ? process.stdout : process.stderr;
  stream.write(`${result.output}\n`);
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { preflight, titleProblem, countHandWritten, parseNumstat, renameNames, SPLIT };
