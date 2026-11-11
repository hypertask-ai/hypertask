const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const INSTALLER = path.resolve('.github/scripts/install-chromium.sh');

function runInstaller(failPlaywright) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyci-282-mirror-'));
  const source = path.join(dir, 'fonts', 'truetype', 'liberation2');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'LiberationSans.ttf'), 'font-bytes');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'strace'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'apt-get'), '#!/bin/sh\necho apt-get >> "$HYCI_CALLS"\nexit 42\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\necho sudo >> "$HYCI_CALLS"\nexit 42\n', { mode: 0o755 });
  fs.writeFileSync(
    path.join(bin, 'npx'),
    `#!/bin/sh
echo "$*" >> "$HYCI_CALLS"
if [ "$1" = playwright ] && [ "$2" = install ] && [ "$3" = chromium ] && [ "$#" -eq 3 ]; then
  if [ "$FAIL_PLAYWRIGHT" = 1 ]; then exit 1; fi
  exit 0
fi
echo "unexpected npx $*" >&2
exit 9
`,
    { mode: 0o755 },
  );
  const calls = path.join(dir, 'calls');
  const result = spawnSync('bash', [INSTALLER], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      HYCI_CALLS: calls,
      FAIL_PLAYWRIGHT: failPlaywright ? '1' : '0',
      BROWSER_FONT_SOURCE: path.join(dir, 'fonts'),
      BROWSER_FONT_CACHE: path.join(dir, 'cache'),
      BROWSER_FONT_USER: path.join(dir, 'user'),
    },
  });
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
    log: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '',
    dir,
    font: path.join(dir, 'user', 'truetype', 'liberation2', 'LiberationSans.ttf'),
  };
}

test('browser installation does not select an Ubuntu archive', () => {
  const installed = runInstaller(false);
  try {
    assert.equal(installed.status, 0, installed.output);
    assert.match(installed.log, /^playwright install chromium$/m);
    assert.doesNotMatch(installed.log, /^apt-get$/m);
    assert.doesNotMatch(installed.log, /^sudo$/m);
    assert.equal(fs.existsSync(installed.font), true);
    assert.match(installed.output, /browser font cache ready/);
    console.log('hyci-282 installer ok');
  } finally {
    fs.rmSync(installed.dir, { recursive: true, force: true });
  }
});

test('a failed browser download does not fall back to apt', () => {
  const failed = runInstaller(true);
  try {
    assert.equal(failed.status, 1, failed.output);
    assert.match(failed.log, /^playwright install chromium$/m);
    assert.doesNotMatch(failed.log, /apt-get|sudo/);
  } finally {
    fs.rmSync(failed.dir, { recursive: true, force: true });
  }
});
