const fs = require("node:fs");

function versionParts(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? ""));
  if (!match) throw new Error(`Node version must look like 24.22.1; got ${JSON.stringify(version ?? null)}`);
  return match.slice(1).map(Number);
}

function meetsFloor(version, minimum) {
  const actual = versionParts(version);
  const required = versionParts(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== required[index]) return actual[index] > required[index];
  }
  return true;
}

if (require.main === module) {
  try {
    const { minimum, advisory } = JSON.parse(fs.readFileSync("src/lib/runtime/nodeSecurityFloor.json", "utf8"));
    const actual = process.argv[2] ?? process.version;
    if (!meetsFloor(actual, minimum)) throw new Error(`Node ${actual} is below the security floor ${minimum} (${advisory})`);
    console.log(`Node security floor passed: ${actual} >= ${minimum}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { meetsFloor };
