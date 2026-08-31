function state() {
  if (!globalThis.__taskMovePrismaState) {
    throw new Error("Task-move Prisma test state is not configured");
  }
  return globalThis.__taskMovePrismaState;
}

module.exports = {
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
