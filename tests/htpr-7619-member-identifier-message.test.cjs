const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const { ProjectAdminInputSchema } = load("src/lib/mcp-server/validations/project.validation.ts", {});

const messages = (input) => {
  const result = ProjectAdminInputSchema.safeParse(input);
  assert.equal(result.success, false);
  return result.error.issues.map((issue) => issue.message);
};

test("still allowed: invite_member accepts an email address, an agent UUID or a user id", () => {
  for (const userToAdd of ["someone@example.com", "379a5d03-0a9f-4e3e-811c-2153e1e107f4", 42]) {
    assert.equal(ProjectAdminInputSchema.safeParse({ action: "invite_member", project_id: 15, userToAdd }).success, true);
  }
});

test("now refused with a field-neutral message: an agent name instead of an id", () => {
  const [message] = messages({ action: "invite_member", project_id: 15, userToAdd: "Grok Bot" });
  assert.equal(message, "Use an email address or agent UUID, not a name");
  assert.doesNotMatch(message, /userToAdd/);
});

test("now refused with a field-neutral message: invite_member without anyone to add", () => {
  const [message] = messages({ action: "invite_member", project_id: 15 });
  assert.equal(message, "An email address or agent UUID is required for invite_member");
  assert.doesNotMatch(message, /userToAdd/);
});
