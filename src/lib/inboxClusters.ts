/**
 * A ticket collapses to ONE inbox row (getAll.ts selects
 * `DISTINCT ON (taskId, notification_inviteId)`), so a "cluster" is the pile of
 * notifications hiding behind that single row. Archiving the row already archives
 * the whole pile; these helpers only make the pile's size visible, in the row
 * tooltip and as Ctrl+K entries for the biggest piles in the current tab.
 */

export type InboxClusterSource = {
  /** INotification declares `string`, but the API sends Prisma's numeric id. */
  id: string | number;
  clusterCount?: number;
  task?: { ticketNumber?: string | null } | null;
};

export type InboxCluster = {
  notificationId: string;
  ticketNumber: string;
  count: number;
};

export const MAX_INBOX_CLUSTER_COMMANDS = 5;

/**
 * Its own palette group, for two reasons: every other group is frecency-sorted,
 * which would bury brand-new keys, and an empty Ctrl+K must not default-highlight
 * an archive, so the group is dropped from the empty-query list.
 */
export const INBOX_CLUSTER_COMMAND_GROUP = "Archive inbox cluster";

export const INBOX_CLUSTER_COMMAND_KEY_PREFIX = "archiveInboxCluster-";

/**
 * Cluster keys must never reach the Frequently used group. That group leads the
 * untyped palette, so a remembered archive would make a bare Ctrl+K then Enter
 * destructive. Frecency is meaningless for these anyway: the key dies with the
 * notification it names.
 */
export const isInboxClusterCommandKey = (key: string): boolean =>
  key.startsWith(INBOX_CLUSTER_COMMAND_KEY_PREFIX);

/**
 * The biggest ticket piles in one inbox tab, largest first.
 *
 * A pile of one is skipped: the row already archives it and "Archive cluster (1)"
 * is just a slower `E`.
 */
export const topInboxClusters = (
  notifications: readonly InboxClusterSource[],
  limit: number = MAX_INBOX_CLUSTER_COMMANDS,
): InboxCluster[] =>
  notifications
    .flatMap((notification) => {
      const count = notification.clusterCount ?? 0;
      const ticketNumber = notification.task?.ticketNumber;
      const notificationId = String(notification.id ?? "");
      if (count < 2 || !ticketNumber || !notificationId) return [];
      return [{ notificationId, ticketNumber, count }];
    })
    // Array.prototype.sort is stable, so equal piles keep the caller's order.
    // The inbox passes its own newest-first list, which keeps renders stable.
    .sort((left, right) => right.count - left.count)
    .slice(0, Math.max(0, limit));

export const inboxClusterCommandName = (cluster: InboxCluster): string =>
  `Archive cluster: ${cluster.ticketNumber.toUpperCase()} (${cluster.count})`;

/** Row tooltip. Singular piles keep the original wording. */
export const inboxArchiveTooltip = (clusterCount: number | undefined): string =>
  clusterCount && clusterCount > 1
    ? `Archive all ${clusterCount}`
    : "Remove notification";
