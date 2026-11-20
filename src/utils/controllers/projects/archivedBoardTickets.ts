import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_9399_ARCHIVED_BOARD_TICKETS_FLAG } from "@/lib/flags/definitions/htpr-9399-archived-board-tickets";

export interface BoardTicketTarget {
  name: string;
  title?: string | null;
  status: string;
}

export interface BoardTicketRefusal {
  message: string;
}

export class ArchivedBoardTicketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchivedBoardTicketError";
  }
}

export const archivedBoardMessage = (board: BoardTicketTarget): string => {
  const label = board.title?.trim() || board.name;
  return `Board "${label}" is archived, so it cannot take new tickets.`;
};

export const archivedBoardTicketRefusal = async (
  board: BoardTicketTarget,
  userId: number,
): Promise<BoardTicketRefusal | null> => {
  if (board.status !== "Archive") return null;
  if (!(await isFeatureEnabled(HTPR_9399_ARCHIVED_BOARD_TICKETS_FLAG, userId))) return null;
  return { message: archivedBoardMessage(board) };
};

export const assertBoardTakesNewTickets = async (
  board: BoardTicketTarget,
  userId: number,
): Promise<void> => {
  const refusal = await archivedBoardTicketRefusal(board, userId);
  if (refusal) throw new ArchivedBoardTicketError(refusal.message);
};
