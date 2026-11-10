const attachOpenBlockingTasksStub = {
  attachOpenBlockingTasks: async (tasks) =>
    tasks.map((task) => ({
      ...task,
      blockingTasks: [],
    })),
};

const blockingTasksMapperStub = {
  mapOpenBlockingTasksForRead: () => [],
};

const blockedByRelationsIncludeStub = () => ({
  where: { relationType: "BlockedBy" },
  select: { targetTask: { select: {} } },
});

module.exports = {
  attachOpenBlockingTasksStub,
  blockingTasksMapperStub,
  blockedByRelationsIncludeStub,
};
