const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const workflow = yaml.load(fs.readFileSync('.github/workflows/ci-tests.yml', 'utf8'));
const step = workflow.jobs['browser-smoke-desktop'].steps.find(step => step.run?.includes('npx playwright install'));

test('browser dependency installation selects the official Ubuntu archive before apt downloads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-mirror-'));
  const mirror = path.join(dir, 'apt-mirrors.txt');
  try {
    fs.writeFileSync(mirror, 'http://azure.archive.ubuntu.com/ubuntu/\nhttps://archive.ubuntu.com/ubuntu/\n');
    for (const [name, content] of Object.entries({
      npm: '#!/bin/bash\nexit 0\n',
      sudo: `#!/bin/bash
set -eu
if [ "$1" = tee ] && [ "$2" = /etc/apt/apt-mirrors.txt ]; then
  exec /usr/bin/tee "$TEST_MIRROR"
fi
if [ "$1" = apt-get ]; then exit 0; fi
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
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', step.run], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_MIRROR: mirror },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(mirror, 'utf8'), 'https://archive.ubuntu.com/ubuntu/\n');
    assert.match(result.stdout, /official archive selected before browser dependencies/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
