const state = {
  task: null,
  project: null,
  outerAssignee: null,
  reAssignee: null,
  txAssignee: null,
  createdRow: null,
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

let findFirstCalls = 0;

function reset(overrides = {}) {
  findFirstCalls = 0;
  state.task = null;
  state.project = null;
  state.outerAssignee = null;
  state.reAssignee = null;
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
      return findFirstCalls === 1 ? state.reAssignee : state.reAssignee;
    },
    findMany: async () => (state.outerAssignee ? [state.outerAssignee] : []),
  },
  $transaction: async (cb) => cb(tx),
  __htpr6279: { state, reset, calls, PrismaClientKnownRequestError },
};

module.exports = prisma;
