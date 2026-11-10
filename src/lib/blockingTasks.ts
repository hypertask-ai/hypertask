import type { IBlockingTask } from "@/models/model";
import { blockerStillOpen } from "@/lib/mcp/tasks/blockerStillOpen";

export type BlockingTaskRelation = { targetTask: IBlockingTask };

export const openBlockingTasks = (
  relations: BlockingTaskRelation[],
  doneTitlesByProject: ReadonlyMap<number, ReadonlySet<string>>,
): IBlockingTask[] =>
  relations
    .map(({ targetTask }) => targetTask)
    .filter((blocker) =>
      blockerStillOpen(blocker, doneTitlesByProject.get(blocker.projectId)),
    );

export const mapOpenBlockingTasksForRead = (blockingTasks: IBlockingTask[]) =>
  blockingTasks.map((blocker) => ({
    id: blocker.id,
    task_id: blocker.id,
    ticketNumber: blocker.ticketNumber || undefined,
    uniqueIndex: blocker.uniqueIndex,
    title: blocker.title,
    section: blocker.section,
    status: blocker.status,
    projectId: blocker.projectId,
    url: `/detail/project-${blocker.projectId}/${blocker.uniqueIndex}`,
  }));
