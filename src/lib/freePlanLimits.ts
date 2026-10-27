export const FREE_PLAN_MAX_BOARDS = 2;
export const FREE_PLAN_MAX_TICKETS = 250;
export const FREE_PLAN_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FREE_PLAN_MAX_FILE_BYTES_RAISED = 25 * 1024 * 1024;
export const FREE_BOARD_LIMIT = 3;

export type FreePlanLimitFlags = {
  planLimits: boolean;
  unlimitedTickets: boolean;
  unlimitedBoards?: boolean;
  raisedFileLimit?: boolean;
};

export type FreePlanLimitLine = {
  title: string;
  amount: string;
};

export function freeFileByteLimit(raised: boolean): number {
  return raised ? FREE_PLAN_MAX_FILE_BYTES_RAISED : FREE_PLAN_MAX_FILE_BYTES;
}

export function freePlanFileMegabytes(raised = false): number {
  return freeFileByteLimit(raised) / (1024 * 1024);
}

export function ticketCapEnforced(flags: FreePlanLimitFlags): boolean {
  return flags.planLimits && !flags.unlimitedTickets;
}

export function freePlanLimitLines(flags: FreePlanLimitFlags): FreePlanLimitLine[] {
  const boardAmount = flags.planLimits && flags.unlimitedBoards
    ? "Unlimited boards"
    : `Up to ${flags.planLimits ? FREE_PLAN_MAX_BOARDS : FREE_BOARD_LIMIT} boards (archived don't count)`;
  const lines: FreePlanLimitLine[] = [
    {
      title: "Boards",
      amount: boardAmount,
    },
    {
      title: "Open tickets",
      amount: ticketCapEnforced(flags)
        ? `Up to ${FREE_PLAN_MAX_TICKETS} open tickets`
        : "Unlimited tickets",
    },
  ];
  if (!flags.planLimits) return lines;
  lines.push({
    title: "Files",
    amount: `Up to ${freePlanFileMegabytes(flags.raisedFileLimit === true)} MB each on tickets and comments`,
  });
  lines.push({
    title: "Teams already over a limit",
    amount: "Keep everything; you just can't add more until you're under it or upgrade",
  });
  return lines;
}

export function freePlanLimitCopy(flags: FreePlanLimitFlags): string[] {
  return freePlanLimitLines(flags).map((line) => line.amount);
}

export function visibleFreePlanCopy(showCopy: boolean, flags: FreePlanLimitFlags): string[] {
  return showCopy ? freePlanLimitCopy(flags) : [];
}
