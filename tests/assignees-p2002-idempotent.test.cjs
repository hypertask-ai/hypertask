// HTPR-6279 — the losing side of a concurrent assign must come back as an
// idempotent "already-assigned" outcome, and only violations of the assignee
// uniqueness indexes may be treated that way. The controller is loaded with a
// scripted Prisma stub (tests/prisma-stub-htpr6279.cjs) so
// tx.assignees.create can be forced to reject with a chosen P2002 — a race the
// per-task mutation fence otherwise serializes away in a real database.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const stub = require(path.join(__dirname, "prisma-stub-htpr6279.cjs")).__htpr6279;

// The assign controller initializes the Firebase Admin SDK at import time; a
// runtime-generated throwaway key satisfies the parser without committing any
// credential material (same approach as the postgres suite).
const { generateKeyPairSync } = require("node:crypto");
const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
process.env.FIREBASE_SERVICE_ACCOUNT_B64 = Buffer.from(
  JSON.stringify({
    project_id: "htpr6279-test",
    client_email: "test@htpr6279-test.iam.gserviceaccount.com",
    private_key: pem,
  })
).toString("base64");

const jiti = require("jiti")(path.join(root, "tests/assignees-p2002-idempotent.test.cjs"), {
  interopDefault: true,
  alias: {
    // Must shadow the real Prisma singleton before the "@" prefix rule.
    "@/lib/prisma": path.join(__dirname, "prisma-stub-htpr6279.cjs"),
    "@": path.join(root, "src"),
  },
});
const assigneesAssign = jiti(
  path.join(root, "src/utils/controllers/assignees/assign.ts")
).default;
const { isAssigneeUniqueIndexError } = jiti(
  path.join(root, "src/utils/controllers/assignees/assign.ts")
);

const owner = {
  id: 6,
  email: "owner@htpr6279.test",
  displayName: "Owner",
  photoURL: undefined,
  uid: "",
  stripe_customer_id: "",
  joinedAt: new Date(),
  UserSettingId: "",
  UserSetting: {},
};

function driverAdapterP2002(constraintName) {
  // Shape observed from the real client against the partial unique indexes
  // (see tests/assignees-unique-index-postgres.test.cjs): the constraint name
  // rides in the driver adapter's original message.
  return new stub.PrismaClientKnownRequestError("P2002", {
    modelName: "Assignees",
    driverAdapterError: {
      name: "DriverAdapterError",
      cause: {
        originalCode: "23505",
        originalMessage: `duplicate key value violates unique constraint "${constraintName}"`,
        kind: "UniqueConstraintViolation",
        constraint: { fields: ['"taskId"', '"userId"'] },
      },
    },
  });
}

function classicP2002(target) {
  return new stub.PrismaClientKnownRequestError("P2002", { target });
}

function seedHappyPath() {
  stub.reset({
    task: {
      id: 42,
      projectId: 15,
      uniqueIndex: 6279,
      title: "Race task",
      ticketNumber: "HTPR-6279",
      sectionId: 1,
      section: "Todo",
      status: "Normal",
    },
    project: { ownerId: owner.id, members: [] },
    // Pre-check sees nothing (the race window); the post-rollback re-read sees
    // the winner's row.
    outerAssignee: null,
    reAssignee: { id: 99 },
    createdRow: { id: 1, user: { displayName: "Owner" }, agent: null, agentAssigner: null },
  });
}

test("isAssigneeUniqueIndexError matches the assignee indexes only", () => {
  assert.equal(isAssigneeUniqueIndexError(driverAdapterP2002("Assignees_taskId_userId_person_key")), true);
  assert.equal(isAssigneeUniqueIndexError(classicP2002(["Assignees_taskId_agentId_key"])), true);
  assert.equal(isAssigneeUniqueIndexError(classicP2002("User_email_key")), false);
  assert.equal(isAssigneeUniqueIndexError(new Error("boom")), false);
});

test("a losing insert on the assignee indexes returns already-assigned", async () => {
  seedHappyPath();
  stub.state.createError = driverAdapterP2002("Assignees_taskId_userId_person_key");

  const result = await assigneesAssign(owner, owner.id, 42, undefined, undefined, {
    intent: "assign",
  });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.assignStatus, "Assigned");
  assert.equal(result.json.assignmentOutcome, "already-assigned");
  assert.equal(stub.calls.createAttempts, 1);
});

test("an unrelated P2002 is not swallowed", async () => {
  seedHappyPath();
  stub.state.createError = classicP2002("User_email_key");

  const result = await assigneesAssign(owner, owner.id, 42, undefined, undefined, {
    intent: "assign",
  });
  // assigneesAssign's catch-all reports the failure instead of pretending the
  // assignment succeeded.
  assert.equal(result.status, 500);
  assert.equal(result.json.assignmentOutcome, undefined);
});

test("a unique loss without a surviving row is not reported as assigned", async () => {
  seedHappyPath();
  stub.state.reAssignee = null; // re-read finds nothing: nobody won
  stub.state.createError = driverAdapterP2002("Assignees_taskId_agentId_key");

  const result = await assigneesAssign(owner, owner.id, 42, undefined, undefined, {
    intent: "assign",
  });
  assert.equal(result.status, 500);
  assert.equal(result.json.assignmentOutcome, undefined);
});
