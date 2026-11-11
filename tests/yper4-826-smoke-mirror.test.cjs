const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const MIRRORS = [
  'https://archive.ubuntu.com/ubuntu/',
  'https://azure.archive.ubuntu.com/ubuntu/',
  'https://mirrors.edge.kernel.org/ubuntu/',
].join('\n') + '\n';

function installShims(dir, { aptGetFails }) {
  const mirror = path.join(dir, 'apt-mirrors.txt');
  fs.writeFileSync(mirror, 'http://azure.archive.ubuntu.com/ubuntu/\nhttps://archive.ubuntu.com/ubuntu/\n');
  const aptGet = aptGetFails
    ? `printf 'strace install was not requested\\n' >&2\nexit 42\n`
    : 'exit 0\n';
  for (const [name, content] of Object.entries({
    npm: '#!/bin/bash\nexit 0\n',
    sudo: `#!/bin/bash
set -eu
if [ "$1" = tee ] && [ "$2" = /etc/apt/apt-mirrors.txt ]; then
  exec /usr/bin/tee "$TEST_MIRROR"
fi
if [ "$1" = apt-get ]; then
  ${aptGet}fi
printf 'Unexpected sudo command\\n' >&2
exit 42
`,
    npx: `#!/bin/bash
set -eu
if [ "$1" = prisma ]; then exit 0; fi
if [ "$1" = playwright ]; then
  first=$(head -1 "$TEST_MIRROR")
  [ "$first" = https://archive.ubuntu.com/ubuntu/ ] || { printf 'Browser dependencies still use Azure first\\n' >&2; exit 41; }
  printf 'official archive selected before browser dependencies\\n'
  exit 0
fi
exit 43
`,
  })) fs.writeFileSync(path.join(dir, name), content, { mode: 0o755 });
  return mirror;
}

function runBash(command, dir, mirror) {
  return spawnSync('bash', ['-euo', 'pipefail', '-c', command], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_MIRROR: mirror },
  });
}

test('browser dependency installation selects the official Ubuntu archive before apt downloads', () => {
  const workflow = yaml.load(fs.readFileSync('.github/workflows/ci-tests.yml', 'utf8'));
  const step = workflow.jobs['browser-smoke-desktop'].steps.find(item => item.run?.includes('install-chromium.sh'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-mirror-'));
  try {
    const mirror = installShims(dir, { aptGetFails: false });
    const result = runBash(step.run, dir, mirror);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(mirror, 'utf8'), MIRRORS);
    assert.match(result.stdout, /official archive selected before browser dependencies/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('browser dependency installation does not install strace unless the workflow asks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-mirror-'));
  try {
    const mirror = installShims(dir, { aptGetFails: true });
    const result = runBash('bash .github/scripts/install-chromium.sh', dir, mirror);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(mirror, 'utf8'), MIRRORS);
    assert.match(result.stdout, /official archive selected before browser dependencies/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
