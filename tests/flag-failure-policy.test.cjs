const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const files = [
  "AGENTS.md",
  ".claude/reference/flags.md",
  ".claude/skills/ship/SKILL.md",
  ".claude/skills/fix-bug/SKILL.md",
  ".claude/skills/vcc/SKILL.md",
  ".claude/skills/verify-qa/SKILL.md",
  ".claude/skills/verify-qa/reference/feature-map/feature-flags-api.md",
  ".claude/skills/verify-qa/reference/feature-map/webhooks.md",
];
const read = (file) => readFileSync(path.join(root, file), "utf8");
const obsolete = [
  "Flagged failures: authorized flag-owner agents hold the flag at Owner + QA first.",
  "A failure means Owner + QA first, never Off.",
  'For any flagged failure, a flag-owner write/admin agent holds the flag at Owner + QA with `ht-flag set KEY owner-qa --failure "<reason>"`, then repairs.',
  "If flagged behavior fails live, hold it at Owner + QA through the approved failure path before repairing.",
  "For flagged behavior, use the emergency failure path to hold it at Owner + QA before repairs.",
  "FAIL: keep In Progress, switch flagged failure Off through [ship](../ship/SKILL.md), repair and repeat.",
  "When flagged behavior fails, a flag-owner write/admin agent holds it at Owner + QA with a failure reason first, then repairs.",
  "For a failed live QA, flag-owner write/admin agents hold the flag at Owner + QA",
  "Switch the flag Off instead.",
  "`OFF` is only the emergency switch after failed live QA.",
];

function checkPolicy(text) {
  assert.match(text, /roll\s?back/i, "failed live QA must direct rollback");
  assert.match(text, /flag modes? unchanged/i, "rollback must preserve flag modes");
  assert.match(text, /\]\([^)]*#failed-live-qa\)/, "link the shared rollback proof procedure");
  for (const instruction of obsolete) {
    assert.ok(!text.includes(instruction), `obsolete failure instruction: ${instruction}`);
  }
}

test("every failure entry point preserves flag modes and links rollback proof", () => {
  for (const file of files) {
    assert.doesNotThrow(() => checkPolicy(read(file)), file);
    for (const match of read(file).matchAll(/\]\(([^)]*)#failed-live-qa\)/g)) {
      const target = path.resolve(root, path.dirname(file), match[1] || path.basename(file));
      assert.ok(existsSync(target), `${file}: missing rollback reference ${target}`);
      assert.match(readFileSync(target, "utf8"), /^## Failed live QA$/m);
    }
  }
});

test("the policy guard rejects every previous hold or Off instruction", () => {
  const current = read(".claude/reference/flags.md");
  for (const instruction of obsolete) {
    assert.throws(() => checkPolicy(`${current}\n${instruction}`), /obsolete failure instruction/);
  }
  assert.throws(() => checkPolicy("Leave every flag mode unchanged. [Proof](#failed-live-qa)"), /direct rollback/);
  assert.throws(() => checkPolicy("Roll back. [Proof](#failed-live-qa)"), /preserve flag modes/);
  assert.throws(() => checkPolicy("Roll back; leave every flag mode unchanged."), /shared rollback proof/);
});

test("rollback proof requires deployment, recovery and before/after modes without staging a real failure", () => {
  const procedure = read(".claude/reference/flags.md").split("## Failed live QA\n")[1]?.split("\n## ")[0];
  assert.ok(procedure, "shared rollback procedure exists");
  assert.match(procedure, /successful Production deployment for the rollback merge SHA/);
  assert.match(procedure, /Repeat the original failing live check/);
  assert.match(procedure, /before\/after modes/);
  assert.match(procedure, /Never manufacture a production failure/);
  assert.match(procedure, /Keep compatible readers/);
  assert.match(procedure, /protected changes still need their authorized reviewer/);
  assert.match(procedure, /Production Revert Proposal workflow handles failed production CI, not live QA/);
});
