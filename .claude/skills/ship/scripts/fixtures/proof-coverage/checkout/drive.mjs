import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { version } from 'proof-fixture';

assert.equal(version, 'prepared dependency');
assert.equal(readFileSync('drive-version.txt', 'utf8'), 'merged');
assert.equal(process.env.SHIP_CHECKOUT, process.cwd());
console.log('drive reached', process.argv[2]);
process.exit(Number(process.env.DRIVE_EXIT || 0));
