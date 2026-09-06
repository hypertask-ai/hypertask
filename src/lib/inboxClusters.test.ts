import assert from "node:assert/strict";
import test from "node:test";

import {
  INBOX_CLUSTER_COMMAND_KEY_PREFIX,
  inboxArchiveTooltip,
  inboxClusterCommandName,
  isInboxClusterCommandKey,
  topInboxClusters,
} from "./inboxClusters";

const row = (id: string, ticketNumber: string | null, clusterCount?: number) => ({
  id,
  clusterCount,
  task: ticketNumber === null ? null : { ticketNumber },
});

test("clusters are ranked by pile size and capped at the limit", () => {
  const clusters = topInboxClusters([
    row("1", "HTPR-1", 3),
    row("2", "HTPR-2", 22),
    row("3", "HTPR-3", 7),
    row("4", "HTPR-4", 14),
    row("5", "HTPR-5", 2),
    row("6", "HTPR-6", 9),
  ]);

  assert.deepEqual(
    clusters.map((cluster) => cluster.ticketNumber),
    ["HTPR-2", "HTPR-4", "HTPR-6", "HTPR-3", "HTPR-1"],
  );
});

test("a pile of one is skipped: pressing E on the row already clears it", () => {
  assert.deepEqual(topInboxClusters([row("1", "HTPR-1", 1), row("2", "HTPR-2")]), []);
});

test("rows with no ticket number are skipped rather than labelled undefined", () => {
  assert.deepEqual(topInboxClusters([row("1", null, 9)]), []);
});

test("ties keep inbox order so the palette list does not reshuffle between renders", () => {
  const clusters = topInboxClusters([row("1", "HTPR-1", 4), row("2", "HTPR-2", 4)]);
  assert.deepEqual(
    clusters.map((cluster) => cluster.ticketNumber),
    ["HTPR-1", "HTPR-2"],
  );
});

test("the command name carries the ticket and its pile size", () => {
  assert.equal(
    inboxClusterCommandName({ notificationId: "1", ticketNumber: "htpr-6141", count: 22 }),
    "Archive cluster: HTPR-6141 (22)",
  );
});

test("the row tooltip names what the key already does, and only when it is a pile", () => {
  assert.equal(inboxArchiveTooltip(22), "Archive all 22");
  assert.equal(inboxArchiveTooltip(1), "Remove notification");
  assert.equal(inboxArchiveTooltip(undefined), "Remove notification");
});

test("cluster keys are recognisable, so they can be kept out of Frequently used", () => {
  // Frequently used leads the untyped palette: a remembered archive there would
  // make a bare Ctrl+K then Enter destructive.
  assert.equal(isInboxClusterCommandKey(`${INBOX_CLUSTER_COMMAND_KEY_PREFIX}1234`), true);
  assert.equal(isInboxClusterCommandKey("createTask"), false);
  assert.equal(isInboxClusterCommandKey("gotoBoard-15"), false);
});
