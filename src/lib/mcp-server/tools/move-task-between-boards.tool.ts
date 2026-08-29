import {
  getMoveTaskBetweenBoardsBaseSchema,
  MoveTaskBetweenBoardsInputSchema,
} from '../validations/task.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { TaskService } from '../lib/services/task.service';
import { normalizeTaskInput } from '../utils/normalize-task-input';

/**
 * Tool: move_task_between_boards
 * Moves a task from one board/project to another.
 * Explicit tool for cross-board moves; use update_task with sectionId for column changes within the same board.
 */
const MoveTaskBetweenBoardsBaseSchema = getMoveTaskBetweenBoardsBaseSchema();

export const moveTaskBetweenBoardsTool = {
  name: TOOL_METADATA.MOVE_TASK_BETWEEN_BOARDS.name,
  description: TOOL_METADATA.MOVE_TASK_BETWEEN_BOARDS.description,
  parameters: MoveTaskBetweenBoardsBaseSchema,
  execute: async (args: unknown, context: any) => {
    const normalizedArgs = normalizeTaskInput(args as Record<string, any>);
    const validatedInput = MoveTaskBetweenBoardsInputSchema.parse(normalizedArgs);

    return executeWithService(
      context,
      TaskService,
      'moveTaskBetweenBoards',
      validatedInput
    );
  },
};
