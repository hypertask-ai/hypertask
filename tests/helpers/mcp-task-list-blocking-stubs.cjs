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

function resolveListImport(request) {
  if (request === "@/utils/controllers/tasks/attachOpenBlockingTasks") {
    return attachOpenBlockingTasksStub;
  }
  if (request === "@/lib/blockingTasks") {
    return blockingTasksMapperStub;
  }
  return undefined;
}

function mergeGetAllIncludesStub(stub) {
  return { blockedByRelationsInclude: blockedByRelationsIncludeStub, ...stub };
}

module.exports = {
  attachOpenBlockingTasksStub,
  blockingTasksMapperStub,
  blockedByRelationsIncludeStub,
  resolveListImport,
  mergeGetAllIncludesStub,
};
