import type { IBlockingTask } from "@/models/model";

import prisma from "@/lib/prisma";
import { isDoneByName } from "@/lib/doneColumns";
import {
  openBlockingTasks,
  type BlockingTaskRelation,
} from "@/lib/blockingTasks";
import { loadDoneTitlesByProject } from "@/utils/controllers/notifications/inboxZero";

export type TaskWithBlockingRelations = {
  relatedFromTasks: BlockingTaskRelation[];
};

export const attachOpenBlockingTasks = async <T extends TaskWithBlockingRelations>(
  tasks: T[],
): Promise<Array<Omit<T, "relatedFromTasks"> & { blockingTasks: IBlockingTask[] }>> => {
  const blockerProjectIds = tasks.flatMap((task) =>
    task.relatedFromTasks.map(({ targetTask }) => targetTask.projectId),
  );
  const doneTitlesByProject = await loadDoneTitlesByProject(
    blockerProjectIds,
    isDoneByName,
    prisma,
  );

  return tasks.map(({ relatedFromTasks, ...task }) => ({
    ...task,
    blockingTasks: openBlockingTasks(relatedFromTasks, doneTitlesByProject),
  }));
};
