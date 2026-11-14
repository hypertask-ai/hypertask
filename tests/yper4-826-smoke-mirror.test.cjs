const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const INSTALLER = path.resolve('.github/scripts/install-chromium.sh');

function runInstaller(failPlaywright, { missingFont, fontCacheStatus = 0, hang, recordTimeout, deadline } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyci-282-mirror-'));
  const source = path.join(dir, 'fonts', 'truetype', 'liberation2');
  fs.mkdirSync(source, { recursive: true });
  for (const font of ['LiberationSans-Regular.ttf', 'NotoColorEmoji.ttf']) {
    if (font !== missingFont) fs.writeFileSync(path.join(source, font), 'font-bytes');
  }
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  fs.symlinkSync('/usr/bin/dirname', path.join(bin, 'dirname'));
  fs.symlinkSync('/bin/bash', path.join(bin, 'bash'));
  const timeoutArgs = path.join(dir, 'timeout-args');
  if (recordTimeout) {
    fs.writeFileSync(path.join(bin, 'timeout'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${timeoutArgs}"\nexit 124\n`, { mode: 0o755 });
  } else {
    fs.symlinkSync('/usr/bin/timeout', path.join(bin, 'timeout'));
  }
  if (fontCacheStatus !== 'missing') {
    fs.writeFileSync(path.join(bin, 'fc-cache'), `#!/bin/sh\n${hang === 'fonts' ? 'exec /bin/sleep 300' : `exit ${fontCacheStatus}`}\n`, { mode: 0o755 });
  }
  fs.writeFileSync(path.join(bin, 'strace'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'apt-get'), '#!/bin/sh\necho apt-get >> "$HYCI_CALLS"\nexit 42\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\necho sudo >> "$HYCI_CALLS"\nexit 42\n', { mode: 0o755 });
  fs.writeFileSync(
    path.join(bin, 'npx'),
    `#!/bin/sh
echo "$*" >> "$HYCI_CALLS"
[ "$*" = 'playwright install chromium' ] || exit 9
${hang === 'download' ? 'exec /bin/sleep 300' : ''}
[ "$FAIL_PLAYWRIGHT" != 1 ]
`,
    { mode: 0o755 },
  );
  const calls = path.join(dir, 'calls');
  const started = Date.now();
  const result = spawnSync('/bin/bash', [INSTALLER], {
    encoding: 'utf8',
    timeout: 8_000,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      PATH: bin,
      HYCI_CALLS: calls,
      FAIL_PLAYWRIGHT: failPlaywright ? '1' : '0',
      BROWSER_FONT_SOURCE: path.join(dir, 'fonts'),
      BROWSER_FONT_CACHE: path.join(dir, 'cache'),
      BROWSER_FONT_USER: path.join(dir, 'user'),
      CHROMIUM_INSTALL_TIMEOUT: deadline === undefined ? '' : String(deadline),
    },
  });
  return {
    status: result.status,
    elapsed: Date.now() - started,
    timeoutArgs: fs.existsSync(timeoutArgs) ? fs.readFileSync(timeoutArgs, 'utf8').trim().split('\n') : [],
    output: `${result.stdout || ''}${result.stderr || ''}`,
    log: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '',
    dir,
    font: path.join(dir, 'user', 'truetype', 'liberation2', 'LiberationSans-Regular.ttf'),
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

for (const missingFont of ['LiberationSans-Regular.ttf', 'NotoColorEmoji.ttf']) {
  test(`browser font cache rejects missing ${missingFont}`, () => {
    const result = runInstaller(false, { missingFont });
    try {
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /browser font cache missing/);
      assert.doesNotMatch(result.output, /browser font cache ready/);
    } finally {
      fs.rmSync(result.dir, { recursive: true, force: true });
    }
  });
}

test('HYCI-285: default deadline leaves five seconds to kill children', () => {
  const result = runInstaller(false, { recordTimeout: true });
  try {
    assert.equal(result.status, 1, result.output);
    assert.deepEqual(result.timeoutArgs, ['-k', '5', '110', 'bash', INSTALLER, '--run']);
    assert.equal((result.output.match(/::error::/g) ?? []).length, 1, result.output);
    assert.match(result.output, /Chromium installation timed out/);
    assert.doesNotMatch(result.output, /Chromium ready/);
  } finally {
    fs.rmSync(result.dir, { recursive: true, force: true });
  }
});

for (const hang of ['download', 'fonts']) {
  test(`HYCI-285: whole-install deadline kills a stalled ${hang}`, () => {
    const result = runInstaller(false, { hang, deadline: 1 });
    try {
      assert.equal(result.status, 1, result.output);
      assert.ok(result.elapsed < 8_000, `${hang} took ${result.elapsed}ms`);
      assert.match(result.log, /^playwright install chromium$/m);
      assert.equal((result.output.match(/::error::/g) ?? []).length, 1, result.output);
      assert.match(result.output, /Chromium installation timed out/);
      assert.doesNotMatch(result.output, /Chromium ready/);
      console.log(`HYCI-285 stalled ${hang}: ${result.elapsed}ms, status ${result.status}`);
    } finally {
      fs.rmSync(result.dir, { recursive: true, force: true });
    }
  });
}

for (const fontCacheStatus of [7, 'missing']) {
  test(`browser font cache rejects font registration failure ${fontCacheStatus}`, () => {
    const result = runInstaller(false, { fontCacheStatus });
    try {
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /browser font registration failed:/);
      assert.doesNotMatch(result.output, /browser font cache ready/);
    } finally {
      fs.rmSync(result.dir, { recursive: true, force: true });
    }
  });
}
