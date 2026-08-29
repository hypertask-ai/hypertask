export type TaskDetailSlug = {
  projectId: number;
  uniqueIndex: number;
};

export type ParityResult = {
  ok: boolean;
  errors: string[];
};

export type TaskDetailBenchmarkReport = {
  userId: number;
  slug: TaskDetailSlug;
  taskId: number;
  commentCount: number;
  ranAt: string;
  harnessMs: number;
  parity: {
    comments: ParityResult;
    descriptionReactions: ParityResult;
    taskCore: ParityResult;
  };
  comparisons: {
    pageTodayMs: number;
    pageProposedMs: number;
    pageImprovementPct: number;
    getTaskTodayMs: number;
    getTaskProposedMs: number;
    getTaskImprovementPct: number;
    commentsTodayMs: number;
    commentsProposedMs: number;
    commentsImprovementPct: number;
    preferencesMs: number;
    processCommentsMs: number;
  };
};
