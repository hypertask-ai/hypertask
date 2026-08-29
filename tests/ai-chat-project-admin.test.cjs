// HTPR-5115/HTPR-5116: AI chat mirrors the MCP project_admin route directly. This repo
// has no database-backed node:test harness, so these assertions guard the tool
// registration, archive confirmation, authorization split, and invite dispatch.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROUTE = path.resolve(
  __dirname,
  "../src/app/api/ai/chat/stream/route.ts",
);

function toolBody(source, toolName) {
  const start = source.indexOf(`${toolName}: tool({`);
  assert.notEqual(start, -1, `${toolName} tool definition not found`);
  const nextToolStart = source.indexOf("\n    hypertask_", start + 1);
  return source.slice(start, nextToolStart === -1 ? undefined : nextToolStart);
}

test("hypertask_project_admin is registered with explicit board administration warnings", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_project_admin");

  assert.match(
    source,
    /hypertask_project_admin: "Managing board administration\.\.\."/,
    "tool must have a user-visible status label",
  );
  assert.match(body, /sendStatus\("hypertask_project_admin"\)/);
  assert.match(body, /action: z\.enum\(\["archive", "invite_member"\]\)/);
  assert.match(body, /project_id: z\.coerce\.number\(\)\.int\(\)\.positive\(\),/);
  assert.match(body, /project_id must be used verbatim as a board ID/);
  assert.match(
    body,
    /Never infer a board from a name or from a number appearing in a board title\./,
  );
  assert.match(
    body,
    /If the user names a board ambiguously, ask which board they mean instead of guessing\./,
  );
  assert.match(
    body,
    /Archiving requires the board's exact title in expected_title as a safety check\./,
  );
  assert.match(body, /Read that title from a tool result; never invent it\./);
  assert.match(
    body,
    /expected_title: z[\s\S]*?Required for archive\. Use the board's exact title from a tool result; do not invent it\./,
  );
  assert.match(
    body,
    /input\.action === "archive"[\s\S]*?expected_title is required for archive[\s\S]*?path: \["expected_title"\]/,
  );
  assert.match(body, /Archiving hides the board for everyone\./);
  assert.match(body, /Inviting grants the person or agent access to the board\./);
  assert.doesNotMatch(body, /createApiClient|createMcpToken|ProjectService|fetch\s*\(/);
});

test("hypertask_project_admin is registered as a write tool", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const writeToolNamesStart = source.indexOf("const writeToolNames = new Set([");
  const writeToolNamesEnd = source.indexOf("]);", writeToolNamesStart);
  const writeToolNames = source.slice(writeToolNamesStart, writeToolNamesEnd);

  assert.match(
    writeToolNames,
    /"hypertask_project_admin"/,
    "every project_admin action mutates board state or access",
  );
});

test("hypertask_project_admin archive and restore are owner-only", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_project_admin");
  const archiveStart = body.indexOf('if (input.action === "archive")');
  const inviteAccessStart = body.indexOf(
    "const access = await validateProjectAccess(input.project_id, user.id)",
  );
  const archiveBranch = body.slice(archiveStart, inviteAccessStart);
  const ownerCheckAt = archiveBranch.indexOf("ownerId: user.id");
  const updateAt = archiveBranch.indexOf("prisma.project.update({");

  assert.notEqual(archiveStart, -1, "archive action branch missing");
  assert.notEqual(inviteAccessStart, -1, "invite access branch missing");
  assert.match(archiveBranch, /const status = input\.status \?\? "Archive"/);
  assert.match(archiveBranch, /status: \{ not: "Deleted" \}/);
  assert.notEqual(ownerCheckAt, -1, "archive must match the authenticated owner");
  assert.notEqual(updateAt, -1, "archive must update the owned project");
  assert.ok(ownerCheckAt < updateAt, "ownership must be checked before archive or restore");
});

test("hypertask_project_admin previews archive and restore without mutating", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_project_admin");
  const archiveStart = body.indexOf('if (input.action === "archive")');
  const inviteAccessStart = body.indexOf(
    "const access = await validateProjectAccess(input.project_id, user.id)",
  );
  const archiveBranch = body.slice(archiveStart, inviteAccessStart);
  const lookupAt = archiveBranch.indexOf("prisma.project.findFirst({");
  const confirmationAt = archiveBranch.indexOf("confirmation_required: true");
  const updateAt = archiveBranch.indexOf("prisma.project.update({");

  assert.match(
    body,
    /confirmed: z[\s\S]*?Set true ONLY after the user has explicitly approved this exact archive or restore in their own message\. Never set it to confirm your own proposal\./,
  );
  assert.match(
    archiveBranch,
    /await requireCrossMessageConfirmation\(\{[\s\S]*?confirmed: input\.confirmed,[\s\S]*?previewsIssuedThisRequest: bulkPreviewsIssued,[\s\S]*?\}\) === "preview"/,
  );
  assert.match(archiveBranch, /success: false,[\s\S]*confirmation_required: true/);
  assert.notEqual(lookupAt, -1, "archive must look up the owned board");
  assert.notEqual(confirmationAt, -1, "archive must return a confirmation preview");
  assert.notEqual(updateAt, -1, "confirmed archive must retain the update path");
  assert.ok(lookupAt < confirmationAt, "board lookup must precede confirmation");
  assert.ok(
    confirmationAt < updateAt,
    "unconfirmed archive must return before the project update",
  );
});

test("hypertask_project_admin confirmation names the exact board", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_project_admin");

  assert.match(body, /const boardTitle = project\.title \|\| project\.name/);
  assert.match(
    body,
    /affected: \[[\s\S]*?project_id: project\.id,[\s\S]*?title: boardTitle/,
  );
  assert.match(
    body,
    /`This would \$\{status === "Archive" \? "archive" : "restore"\} board \$\{project\.id\}, "\$\{boardTitle\}"\./,
  );
});

test("hypertask_project_admin rejects a mismatched title, names both titles, and does not mutate", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_project_admin");
  const inviteAccessStart = body.indexOf(
    "const access = await validateProjectAccess(input.project_id, user.id)",
  );
  const archiveBranch = body.slice(0, inviteAccessStart);
  const titleGateAt = archiveBranch.indexOf(
    "if (expectedTitle.toLowerCase() !== boardTitle.trim().toLowerCase())",
  );
  const mismatchReturnAt = archiveBranch.indexOf(
    "error: `Board title mismatch:",
  );
  const updateAt = archiveBranch.indexOf("prisma.project.update({");

  assert.match(archiveBranch, /const expectedTitle = input\.expected_title!\.trim\(\)/);
  assert.match(
    archiveBranch,
    /error: `Board title mismatch: supplied "\$\{expectedTitle\}", but board \$\{project\.id\}'s actual title is "\$\{boardTitle\}"\. Nothing has been changed\.`/,
  );
  assert.notEqual(titleGateAt, -1, "archive title gate missing");
  assert.notEqual(mismatchReturnAt, -1, "title mismatch error missing");
  assert.notEqual(updateAt, -1, "archive update path missing");
  assert.ok(titleGateAt < mismatchReturnAt, "mismatch must return from the title gate");
  assert.ok(mismatchReturnAt < updateAt, "mismatched title must return before mutation");
});

test("hypertask_project_admin archive with the exact trimmed title proceeds", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_project_admin");
  const inviteAccessStart = body.indexOf(
    "const access = await validateProjectAccess(input.project_id, user.id)",
  );
  const archiveBranch = body.slice(0, inviteAccessStart);
  const titleGateAt = archiveBranch.indexOf(
    "if (expectedTitle.toLowerCase() !== boardTitle.trim().toLowerCase())",
  );
  const updateAt = archiveBranch.indexOf("prisma.project.update({");

  assert.notEqual(titleGateAt, -1, "archive title gate missing");
  assert.notEqual(updateAt, -1, "exact-title archive update path missing");
  assert.ok(titleGateAt < updateAt, "an exact title must proceed past the title gate");
});

test("hypertask_project_admin checks the title even when confirmed is true", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_project_admin");
  const inviteAccessStart = body.indexOf(
    "const access = await validateProjectAccess(input.project_id, user.id)",
  );
  const archiveBranch = body.slice(0, inviteAccessStart);
  const titleGateAt = archiveBranch.indexOf(
    "if (expectedTitle.toLowerCase() !== boardTitle.trim().toLowerCase())",
  );
  const confirmationGateAt = archiveBranch.indexOf(
    "await requireCrossMessageConfirmation({",
  );

  assert.notEqual(titleGateAt, -1, "archive title gate missing");
  assert.notEqual(confirmationGateAt, -1, "archive confirmation gate missing");
  assert.ok(
    titleGateAt < confirmationGateAt,
    "title mismatch must fail before confirmation is evaluated",
  );
});

test("hypertask_project_admin keeps the archive update path after the gate and invite stays ungated", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_project_admin");
  const inviteAccessStart = body.indexOf(
    "const access = await validateProjectAccess(input.project_id, user.id)",
  );
  const archiveBranch = body.slice(0, inviteAccessStart);
  const inviteBranch = body.slice(inviteAccessStart);
  const confirmationGateAt = archiveBranch.indexOf(
    "await requireCrossMessageConfirmation({",
  );
  const updateAt = archiveBranch.indexOf("prisma.project.update({");

  assert.notEqual(confirmationGateAt, -1, "archive confirmation gate missing");
  assert.notEqual(updateAt, -1, "confirmed archive update path missing");
  assert.ok(confirmationGateAt < updateAt, "approved archive must proceed past the gate");
  assert.doesNotMatch(
    inviteBranch,
    /input\.confirmed|input\.expected_title|confirmation_required|bulkPreviewsIssued/,
  );
  assert.match(inviteBranch, /addAgentToBoard\(/);
  assert.match(inviteBranch, /addMemberController\(/);
});

test("hypertask_project_admin dispatches user IDs and agent UUIDs differently", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_project_admin");
  const accessAt = body.indexOf(
    "validateProjectAccess(input.project_id, user.id)",
  );
  const uuidAt = body.indexOf(
    "PROJECT_ADMIN_MEMBER_UUID_PATTERN.test(input.userToAdd)",
  );
  const agentAt = body.indexOf("addAgentToBoard(");
  const userLookupAt = body.indexOf("prisma.user.findUnique({");
  const memberAt = body.indexOf("addMemberController(");

  assert.notEqual(accessAt, -1, "invite must require board access");
  assert.notEqual(uuidAt, -1, "invite must recognize agent UUIDs");
  assert.notEqual(agentAt, -1, "agent UUIDs must use addAgentToBoard");
  assert.notEqual(userLookupAt, -1, "numeric user IDs must resolve through the user table");
  assert.notEqual(memberAt, -1, "human invites must use addMemberController");
  assert.ok(accessAt < agentAt, "board access must be checked before inviting an agent");
  assert.ok(accessAt < memberAt, "board access must be checked before inviting a user");
  assert.ok(uuidAt < agentAt, "UUID detection must dispatch to the agent controller");
  assert.ok(userLookupAt < memberAt, "user ID email resolution must precede the human invite");
});
