const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const source = readFileSync(path.join(__dirname, '../.github/workflows/premerge-click.yml'), 'utf8');
const pins = new Map();
for (const match of source.matchAll(/uses: ([\w-]+\/[\w-]+)(?:\/[\w-]+)?@([a-f0-9]{40}) # (v[\d.]+)/g)) {
  pins.set(`${match[1]}@${match[3]}`, { repo: match[1], sha: match[2], tag: match[3] });
}
assert.ok(pins.size >= 4);
for (const { repo, sha, tag } of pins.values()) {
  let object = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/git/ref/tags/${tag}`], { encoding: 'utf8' })).object;
  if (object.type === 'tag') object = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/git/tags/${object.sha}`], { encoding: 'utf8' })).object;
  assert.equal(object.type, 'commit');
  assert.equal(object.sha, sha, `${repo} ${tag}`);
  console.log(`${repo} ${tag} ${sha}: PASS`);
}
console.log(`action pins verified: ${pins.size} passed, 0 failed`);
