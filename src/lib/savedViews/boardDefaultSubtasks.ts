import { featureFlagsForUser } from "@/lib/flags";
import { HTPR_9274_BOARD_DEFAULT_SUBTASKS_FLAG } from "@/lib/flags/definitions/htpr-9274-board-default-subtasks";

export const boardDefaultShowsSubtasks = async (userId: number): Promise<boolean> => {
  try { return (await featureFlagsForUser(userId))[HTPR_9274_BOARD_DEFAULT_SUBTASKS_FLAG] === true }
  catch { return false }
};
