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
