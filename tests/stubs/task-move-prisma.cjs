function state() {
  if (!globalThis.__taskMovePrismaState) {
    throw new Error("Task-move Prisma test state is not configured");
  }
  return globalThis.__taskMovePrismaState;
}

const lockTails = new Map();

module.exports = {
  $transaction: async (callback) => {
    let releaseLock;
    const tx = {
      ...module.exports,
      $queryRaw: async (query) => {
        const key = JSON.stringify(query.values ?? []);
        state().locks.push({ key, query });
        const previous = lockTails.get(key) ?? Promise.resolve();
        let release;
        const held = new Promise((resolve) => {
          release = resolve;
        });
        const tail = previous.then(() => held);
        lockTails.set(key, tail);
        await previous;
        releaseLock = () => {
          release();
          if (lockTails.get(key) === tail) lockTails.delete(key);
        };
        return [{ pg_advisory_xact_lock: null }];
      },
    };
    try {
      return await callback(tx);
    } finally {
      releaseLock?.();
    }
  },
  comment: {
    findFirst: async () => state().previous,
    update: async (args) => {
      state().updates.push(args);
      state().previous = {
        ...state().previous,
        ...args.data,
        id: args.where.id,
      };
      return state().previous;
    },
    delete: async (args) => {
      state().deletes.push(args);
      return { id: args.where.id };
    },
    create: async ({ data }) => {
      state().creates.push(data);
      return { id: 100 + state().creates.length, createdAt: new Date(), ...data };
    },
  },
  task: {
    findUnique: async () => ({ updatedByUserIds: [6] }),
    update: async () => ({}),
  },
};
