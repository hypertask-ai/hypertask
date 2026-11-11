const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const INSTALLER = '.github/scripts/install-chromium.sh';

test('browser dependency installation selects the official Ubuntu archive when it answers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-mirror-'));
  const mirror = path.join(dir, 'apt-mirrors.txt');
  try {
    for (const [name, content] of Object.entries({
      curl: `#!/bin/bash
url="\${@: -1}"
case "$url" in *archive.ubuntu.com*) exit 0;; esac
exit 6
`,
      sudo: `#!/bin/bash
set -eu
if [ "$1" = tee ]; then exec /usr/bin/tee "$2"; fi
if [ "$1" = apt-get ]; then exit 0; fi
printf 'Unexpected sudo command\\n' >&2
exit 42
`,
      'apt-get': '#!/bin/bash\nexit 0\n',
      npx: `#!/bin/bash
set -eu
if [ "$1" = prisma ]; then exit 0; fi
if [ "$1" = playwright ]; then
  first=$(head -1 "$TEST_MIRROR")
  [ "$first" = https://archive.ubuntu.com/ubuntu/ ] || { printf 'Browser dependencies do not use the official archive first\\n' >&2; exit 41; }
  printf 'official archive selected before browser dependencies\\n'
  exit 0
fi
exit 43
`,
    })) fs.writeFileSync(path.join(dir, name), content, { mode: 0o755 });
    const result = spawnSync('bash', [INSTALLER], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        TEST_MIRROR: mirror,
        APT_MIRROR_FILE: mirror,
        RETRY_SLEEP: '0',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(mirror, 'utf8'), 'https://archive.ubuntu.com/ubuntu/\n');
    assert.match(result.stdout, /official archive selected before browser dependencies/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
