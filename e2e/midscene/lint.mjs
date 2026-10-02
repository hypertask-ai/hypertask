import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
for (const dir of ['.', 'flows']) {
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.mjs'))) {
    execFileSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
  }
}
for (const file of ['nightly.sh', 'guarded-run.sh', 'cleanup.sh']) {
  execFileSync('bash', ['-n', file], { stdio: 'inherit' });
}
execFileSync('shellcheck', ['--severity=warning', 'nightly.sh', 'guarded-run.sh'], { stdio: 'inherit' });
console.log('Midscene syntax checks passed');
