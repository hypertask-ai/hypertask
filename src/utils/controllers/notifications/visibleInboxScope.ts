import { Prisma } from "@prisma/client";

import { inboxConfig } from "@/lib/configs/inbox.config";

/**
 * The server-side notification scope behind the user Inbox's visible All tab.
 *
 * Synthetic waiting-on rows belong only to the dedicated Blocked by you split;
 * getInboxTabs explicitly omits them from All. Keep cleanup, counts, and the
 * rendered All tab on this predicate so cleanup cannot reach hidden records.
 * A visible persisted notification is task-backed: `task.status = Normal`
 * intentionally excludes taskless rows before any response projection loads.
 */
export const visibleUserInboxWhere = (
  userId: number
): Prisma.NotificationWhereInput => ({
  status: "Normal",
  archivedAt: null,
  userId,
  agentId: null,
  NOT: {
    fromUserId: userId,
    fromAgentId: null,
    type: { in: inboxConfig.selfTriggeredHidden },
  },
  AND: [
    {
      OR: [
        { task: { status: "Normal" } },
        // A reminder that fires after its task archived (e.g. a Done column
        // auto-archive) still returned the row on purpose — an archived task
        // must not swallow it silently (HTPR-5683).
        { task: { status: "Archive" }, returnedFromReminders: true },
      ],
    },
    {
      OR: [
        {
          task: {
            Reminders: {
              every: {
                status: { not: "Normal" },
              },
            },
          },
        },
        { taskId: null },
      ],
    },
  ],
});
