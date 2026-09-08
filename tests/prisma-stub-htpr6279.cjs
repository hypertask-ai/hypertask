// Configurable Prisma stub for tests/assignees-p2002-idempotent.test.cjs.
// assign.ts imports the real Prisma singleton from "@/lib/prisma"; the test
// maps that specifier to this module (jiti interopDefault hands the module
// exports to the importer as the default), so this file exports the prisma
// object itself with the test knobs attached.
const state = {
  task: null,
  project: null,
  outerAssignee: null,
  // Row seen by the post-rollback re-read (null = nobody won).
  reAssignee: null,
  txAssignee: null,
  createdRow: null,
  // Error thrown by tx.assignees.create, or null to succeed.
  createError: null,
};

const calls = { createAttempts: 0, createArgs: [] };

class PrismaClientKnownRequestError extends Error {
  constructor(code, meta) {
    super(`${code}: ${JSON.stringify(meta)}`);
    this.code = code;
    this.meta = meta;
  }
}

const tx = {
  $executeRaw: async () => 0,
  // assign.ts invokes $queryRaw as a tagged template; a plain async function
  // works as the tag and returns no active lease.
  $queryRaw: async () => [],
  task: {
    findUnique: async () => state.task,
  },
  taskLease: {
    deleteMany: async () => ({}),
  },
  assignees: {
    findFirst: async () => state.txAssignee,
    create: async (args) => {
      calls.createAttempts += 1;
      calls.createArgs.push(args);
      if (state.createError) throw state.createError;
      return state.createdRow;
    },
  },
};

// The pre-transaction existence check and the post-rollback re-read share
// prisma.assignees.findFirst; they return outerAssignee and reAssignee
// respectively (the re-read only happens after a create attempt).
let findFirstCalls = 0;

function reset(overrides = {}) {
  findFirstCalls = 0;
  state.task = null;
  state.project = null;
  state.outerAssignee = null;
  state.txAssignee = null;
  state.createdRow = null;
  state.createError = null;
  calls.createAttempts = 0;
  calls.createArgs = [];
  Object.assign(state, overrides);
}

const prisma = {
  task: { findUnique: async () => state.task },
  agent: { findFirst: async () => null, findUnique: async () => null },
  user: { findUnique: async () => null },
  project: { findFirst: async () => state.project },
  subscribedDevices: { findMany: async () => [] },
  assignees: {
    findFirst: async () => {
      findFirstCalls += 1;
      return findFirstCalls === 1 ? state.outerAssignee : state.reAssignee;
    },
    findMany: async () => [],
  },
  $transaction: async (cb) => cb(tx),
  // Test knobs ride on the same object because interopDefault exposes exactly
  // this object as the importer's default import.
  __htpr6279: { state, reset, calls, PrismaClientKnownRequestError },
};

module.exports = prisma;
