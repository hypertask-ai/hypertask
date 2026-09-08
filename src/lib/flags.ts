import type {
  FeatureFlagMode as PrismaFeatureFlagMode,
  PrismaClient,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG } from "@/lib/agentRuns/model";
import {
  AGENT_CHAT_BRIEF_FLAG,
  AGENT_CHAT_SKILLS_FLAG,
  AGENT_CHAT_TICKET_CONFIRM_FLAG,
  AUTO_TASK_DESCRIPTIONS_FLAG,
  COLUMN_ALL_VIEWS_FLAG,
  CORE_ACTIONS_SMOKE_FLAG,
  HEIC_ATTACHMENTS_FLAG,
  HTPR_6278_CHAT_TURN_FAILURE_FLAG,
  FEATURE_FLAG_DETAILS_FLAG,
  FIGMA_CONNECT_FLAG,
  FLAG_REMOVAL_COUNTDOWN_FLAG,
  CONFIRMED_PROPOSAL_HEADING_FLAG,
  LAZY_EMOJI_LIST_FLAG,
  FLAG_SHIP_DATE_CLUSTER_FLAG,
  FLAG_SORT_FILTER_FLAG,
  FLAG_TICKET_TITLE_FLAG,
  INBOX_ARCHIVE_CLUSTER_FLAG,
  PAGE_MENTIONS_FLAG,
  SHORTCUT_NUDGES_FLAG,
  MANAGER_LOOP_ACTIVITY_FLAG,
  HTPR_6284_AGENT_MENTION_ROUTING_FLAG,
} from "@/lib/flags/keys";

// Re-exported so server code keeps importing keys from here. Client components must
// import "@/lib/flags/keys" directly: this module reaches ioredis through the auth
// stack and cannot enter a browser bundle.
export * from "@/lib/flags/keys";

export const FEATURE_FLAG_OWNER_USER_ID = 6;
const FEATURE_FLAG_OWNER = {
  userId: FEATURE_FLAG_OWNER_USER_ID,
  email: "valentin.yeo@gmail.com",
} as const;
export const FEATURE_FLAG_QA_USER_ID = 985;
const FEATURE_FLAG_QA_USER = {
  userId: FEATURE_FLAG_QA_USER_ID,
  email: "valentin@hypertask.ai",
} as const;

const FEATURE_FLAG_DEFINITIONS = [
  {
    key: HTPR_6284_AGENT_MENTION_ROUTING_FLAG,
    shippedOn: "2026-09-08",
    description:
      "When you @name an agent in the AI chat, your message goes to that agent and its reply appears in the chat under its name, instead of the AI assistant answering for it.",
  },
  {
    key: HTPR_6278_CHAT_TURN_FAILURE_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Ends AI Chat turns that run out of time with a clear, saved failure message instead of a silent disconnect, and shows the server's real refusal instead of 'Connection lost'.",
  },
  {
    key: HEIC_ATTACHMENTS_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Shows a HEIC, HEIF or TIFF attachment as a named file you can download, instead of the broken-image icon a browser paints when it cannot decode the format.",
  },
  {
    key: CORE_ACTIONS_SMOKE_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Runs the logged-in core-action production check and restores its isolated fixture after each run.",
  },
  {
    key: AGENT_CHAT_SKILLS_FLAG,
    shippedOn: "2026-09-07",
    description:
      "Lets people import skills from GitHub and invoke installed skills in Agent Chat with /slug.",
  },
  {
    key: "htpr-5913-consistent-comment-shortcuts",
    shippedOn: "2026-09-04",
    description:
      "Makes comment shortcuts consistent: Ctrl+Enter sends and moves on, while Ctrl+Shift+Enter sends and stays.",
  },
  {
    key: "htpr-5992-mobile-all-tasks",
    shippedOn: "2026-09-04",
    description: "Shows the redesigned All Tasks view on mobile devices.",
  },
  {
    key: "htpr-5993-optimistic-task-uploads",
    shippedOn: "2026-09-04",
    description: "Saves new tasks immediately while their attachments continue uploading.",
  },
  {
    key: AGENT_CHAT_TICKET_CONFIRM_FLAG,
    shippedOn: "2026-09-05",
    description: "Requires a confirmed board ticket before Agent Chat can start side-effecting work.",
  },
  {
    key: "htpr-6072-shallow-board-switch",
    shippedOn: "2026-09-04",
    description: "Switches between cached boards without remounting the whole board screen.",
  },
  {
    key: "htpr-6091-feature-flags",
    shippedOn: "2026-09-04",
    description:
      "Registers the feature flag controls themselves; the owner-only admin page stays available in every mode.",
  },
  {
    key: "htpr-6094-agent-activity-rows",
    shippedOn: "2026-09-05",
    description: "Shows passive ticket progress between normal messages in Agent Chat.",
  },
  {
    key: "htpr-6112-copy-current-url",
    shippedOn: "2026-09-04",
    description: "Adds a Copy current URL action to the command menu.",
  },
  {
    key: "htpr-6115-agent-sdk",
    shippedOn: "2026-09-04",
    description: "Enables the shared Agent SDK run model and lifecycle endpoints.",
  },
  {
    key: "htpr-6118-comment-reactions-api",
    shippedOn: "2026-09-04",
    description: "Lets agents add and remove emoji reactions on comments through the API and CLI.",
  },
  {
    key: "htpr-6122-agent-run-activities",
    shippedOn: "2026-09-04",
    description: "Enables typed thought, action, response, error, and question updates for agent runs.",
  },
  {
    key: "htpr-6123-add-typescript-agent-sdk",
    shippedOn: "2026-09-05",
    description: "Allows the TypeScript Agent SDK to read and update agent runs.",
  },
  {
    key: "htpr-6124-agent-dev-loop",
    shippedOn: "2026-09-05",
    description:
      "Lets an agent author replay a recorded run into a handler running on their own machine.",
  },
  {
    key: "htpr-6129-mobile-agent-chat-viewport",
    shippedOn: "2026-09-04",
    description: "Keeps the full Agent Chat visible on mobile when the keyboard is open.",
  },
  {
    key: "htpr-6130-mobile-reminder-safe-area",
    shippedOn: "2026-09-04",
    description: "Keeps the mobile reminder time selector aligned and clear of bottom controls.",
  },
  {
    key: FEATURE_FLAG_DETAILS_FLAG,
    shippedOn: "2026-09-04",
    description: "Shows a plain-language description and ticket link for every feature flag.",
  },
  {
    key: FIGMA_CONNECT_FLAG,
    shippedOn: "2026-09-06",
    description: "Lets each user connect a Figma account so linked frames render as previews.",
  },
  {
    key: "htpr-6141-ai-first-task-writer",
    shippedOn: "2026-09-04",
    description: "Opens the AI task writer from a column plus instead of the classic new-task form.",
  },
  {
    key: "htpr-6175-quick-entry-cards",
    shippedOn: "2026-09-07",
    description: "Opens a small inline box for the column plus and the table's New task button so several cards can be entered one after another without the full editor.",
  },
  {
    key: AGENT_CHAT_BRIEF_FLAG,
    shippedOn: "2026-09-05",
    description:
      "Gives Agent Chat a bounded snapshot of each agent's current and recent work.",
  },
  {
    key: AUTO_TASK_DESCRIPTIONS_FLAG,
    shippedOn: "2026-09-05",
    description:
      "Drafts a task description from the title while you type, below an empty description.",
  },
  {
    key: FLAG_TICKET_TITLE_FLAG,
    shippedOn: "2026-09-05",
    description: "Shows the linked ticket's title as the primary label on the flags admin page.",
  },
  {
    key: FLAG_SORT_FILTER_FLAG,
    shippedOn: "2026-09-05",
    description:
      "Sorts and clusters the feature flags page by release date, with an audience filter.",
  },
  {
    key: FLAG_SHIP_DATE_CLUSTER_FLAG,
    shippedOn: "2026-09-06",
    description: "Groups the feature flags page by the day each flag first reached production.",
  },
  {
    key: AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG,
    shippedOn: "2026-09-06",
    description:
      "Lets people stop stuck Agent Chat turns and ends unanswered turns after five minutes.",
  },
  {
    key: PAGE_MENTIONS_FLAG,
    shippedOn: "2026-09-06",
    description:
      "Offers the board's canvas pages in the @ menu, so a comment or description can link a page like it links a task.",
  },
  {
    key: INBOX_ARCHIVE_CLUSTER_FLAG,
    shippedOn: "2026-09-06",
    description:
      "Adds Ctrl+K entries for the five biggest ticket piles in the inbox, and names the row archive action after what it already does.",
  },
  {
    key: COLUMN_ALL_VIEWS_FLAG,
    shippedOn: "2026-09-07",
    description:
      "Adds Show in all views and Hide in all views to the column editor, so one column's visibility changes across every saved view at once.",
  },
  {
    key: FLAG_REMOVAL_COUNTDOWN_FLAG,
    shippedOn: "2026-09-07",
    description:
      "Counts down the 14 days before an Everyone flag is removed from the code, with a Keep switch that stops it. Set this flag itself to Everyone to let the daily sweep file the removal tickets.",
  },
  {
    key: SHORTCUT_NUDGES_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Shows a shortcut tip on the next task page after three mouse-click notification archives in the inbox.",
  },
  {
    key: CONFIRMED_PROPOSAL_HEADING_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Head the Agent Chat proposal card 'Ticket created' once the ticket exists, instead of 'Ticket proposed, nothing done yet'.",
  },
  {
    key: MANAGER_LOOP_ACTIVITY_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Shows each scheduled Manager loop cycle in Agent Chat as a timestamped activity entry, including quiet and failed cycles.",
  },
  {
    key: LAZY_EMOJI_LIST_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Downloads the editor's big emoji list only when you type a colon, instead of on every task open. Nothing visible changes.",
  },
  // ponytail: `shippedOn` is the calendar day the key first reached production, written by hand
  // because git history is not readable at runtime. Backfilled with
  // `git log -S"<key>" --format=%cd --date=short production | tail -1`. An author adding a flag
  // writes the date they expect to merge, so it can be a day early if the pull request sits
  // overnight; run the same command after merging to correct it. Upgrade path if that ever
  // matters: generate this map from git at build time.
] as const satisfies readonly { key: string; description: string; shippedOn: string }[];

export const FEATURE_FLAG_KEYS = FEATURE_FLAG_DEFINITIONS.map(({ key }) => key);
// HTPR-6128 explicitly exempts this bootstrap mode: gating flag infrastructure by itself is circular.
export const FEATURE_FLAG_MODES = [
  "OWNER_ONLY",
  "OWNER_AND_QA",
  "EVERYONE",
  "OFF",
] as const;
export type FeatureFlagMode = PrismaFeatureFlagMode;

export class FeatureFlagInputError extends Error {}

type FeatureFlagDatabase = {
  featureFlag: Pick<PrismaClient["featureFlag"], "findUnique">;
  user: Pick<PrismaClient["user"], "findUnique">;
};

async function matchesFeatureFlagIdentity(
  userId: number,
  identity: { userId: number; email: string },
  db: FeatureFlagDatabase = prisma,
): Promise<boolean> {
  if (userId !== identity.userId) return false;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return user?.email.trim().toLowerCase() === identity.email;
}

const isFeatureFlagOwnerUser = (
  userId: number,
  db: FeatureFlagDatabase = prisma,
) => matchesFeatureFlagIdentity(userId, FEATURE_FLAG_OWNER, db);

const isFeatureFlagQaUser = (
  userId: number,
  db: FeatureFlagDatabase = prisma,
) => matchesFeatureFlagIdentity(userId, FEATURE_FLAG_QA_USER, db);

export async function isFeatureFlagOwner(headers: Headers): Promise<boolean> {
  const session = await getSessionUser(headers);
  return session ? isFeatureFlagOwnerUser(session.userId) : false;
}

export type FeatureFlagRow = {
  key: string;
  mode: FeatureFlagMode;
  updatedAt: Date | null;
  releasedAt: Date | null;
  keep: boolean;
  removalTaskId: number | null;
  shippedOn: string | null;
  description: string;
  ticketUrl: string | null;
  ticketTitle: string | null;
};

const FEATURE_FLAG_ROW_SELECT = {
  key: true,
  mode: true,
  updatedAt: true,
  releasedAt: true,
  keep: true,
  removalTaskId: true,
} as const;

export const FEATURE_FLAG_TICKET_PROJECT_ID = 15;
// Serialises the read-decide-write in setFeatureFlagMode. Without it two fast clicks can both read
// the old mode, and an OFF write landing after an EVERYONE write leaves EVERYONE on a stale date.
const FEATURE_FLAG_MODE_LOCK_NAMESPACE = 6193;
const FEATURE_FLAG_TICKET_BASE = "https://app.hypertask.ai/detail/project-15";
export const FEATURE_FLAG_ADMIN_URL = "https://app.hypertask.ai/admin/flags";
const LEGACY_FEATURE_FLAG_DESCRIPTION =
  "This older feature flag has no description in this version of the app.";
const FEATURE_FLAG_KEY_TICKET_NUMBER = /^htpr-([1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

function withFeatureFlagMetadata(
  row: Pick<FeatureFlagRow, "key" | "mode" | "updatedAt" | "releasedAt" | "keep" | "removalTaskId">,
  ticketTitleByNumber: Map<number, string>,
): FeatureFlagRow {
  const definition = FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === row.key);
  const ticketNumber = FEATURE_FLAG_KEY_TICKET_NUMBER.exec(row.key)?.[1];
  return {
    ...row,
    description: definition?.description ?? LEGACY_FEATURE_FLAG_DESCRIPTION,
    shippedOn: definition?.shippedOn ?? null,
    ticketUrl: ticketNumber ? `${FEATURE_FLAG_TICKET_BASE}/${ticketNumber}` : null,
    ticketTitle: ticketNumber ? (ticketTitleByNumber.get(Number(ticketNumber)) ?? null) : null,
  };
}

async function loadFeatureFlagTicketTitles(keys: readonly string[]): Promise<Map<number, string>> {
  const ticketNumbers = keys
    .map((key) => FEATURE_FLAG_KEY_TICKET_NUMBER.exec(key)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number);
  if (ticketNumbers.length === 0) return new Map();
  const tickets = await prisma.task.findMany({
    where: { projectId: FEATURE_FLAG_TICKET_PROJECT_ID, uniqueIndex: { in: ticketNumbers } },
    select: { uniqueIndex: true, title: true },
  });
  return new Map(tickets.map((ticket) => [ticket.uniqueIndex, ticket.title]));
}

export function featureFlagModeEnabled(
  mode: FeatureFlagMode,
  isOwner: boolean,
  isQa: boolean,
): boolean {
  if (mode === "EVERYONE") return true;
  if (mode === "OWNER_AND_QA") return isOwner || isQa;
  if (mode === "OWNER_ONLY") return isOwner;
  return false;
}

// HTPR-6192: a flag with no stored row is on for the owner and the QA account, never owner-only,
// so the QA agent can verify a feature before Valentin looks at it. Choosing Only me stays possible,
// but it has to be set on the admin page on purpose.
const DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA";

/**
 * The user ids a flag can possibly be on for, or null when it is on for
 * everyone. A coarse prefilter only: isFeatureEnabled still decides per user.
 */
export async function featureFlagCandidateUserIds(
  key: string,
  db: FeatureFlagDatabase = prisma,
): Promise<number[] | null> {
  const row = await db.featureFlag.findUnique({ where: { key }, select: { mode: true } });
  const mode = row?.mode ?? DEFAULT_FEATURE_FLAG_MODE;
  if (mode === "EVERYONE") return null;
  if (mode === "OFF") return [];
  return mode === "OWNER_AND_QA"
    ? [FEATURE_FLAG_OWNER_USER_ID, FEATURE_FLAG_QA_USER_ID]
    : [FEATURE_FLAG_OWNER_USER_ID];
}

export async function isFeatureEnabled(
  key: string,
  userId: number,
  db: FeatureFlagDatabase = prisma,
): Promise<boolean> {
  const row = await db.featureFlag.findUnique({
    where: { key },
    select: { mode: true },
  });
  const declared = (FEATURE_FLAG_KEYS as readonly string[]).includes(key);
  if (!row && !declared) return false;
  const mode = row?.mode ?? DEFAULT_FEATURE_FLAG_MODE;
  const includesOwner = mode === "OWNER_ONLY" || mode === "OWNER_AND_QA";
  return featureFlagModeEnabled(
    mode,
    includesOwner && (await isFeatureFlagOwnerUser(userId, db)),
    mode === "OWNER_AND_QA" && (await isFeatureFlagQaUser(userId, db)),
  );
}

export async function listFeatureFlagModes(
  options: { includeTicketTitles?: boolean } = {},
): Promise<FeatureFlagRow[]> {
  const stored = await prisma.featureFlag.findMany({
    select: FEATURE_FLAG_ROW_SELECT,
    orderBy: { key: "asc" },
  });
  const ticketTitleByNumber = options.includeTicketTitles
    ? await loadFeatureFlagTicketTitles([
        ...new Set([...FEATURE_FLAG_KEYS, ...stored.map(({ key }) => key)]),
      ])
    : new Map<number, string>();
  const byKey = new Map<string, FeatureFlagRow>(
    FEATURE_FLAG_KEYS.map((key) => [
      key,
      withFeatureFlagMetadata(
        { key, mode: DEFAULT_FEATURE_FLAG_MODE, updatedAt: null, releasedAt: null, keep: false, removalTaskId: null },
        ticketTitleByNumber,
      ),
    ]),
  );
  stored.forEach((row) => byKey.set(row.key, withFeatureFlagMetadata(row, ticketTitleByNumber)));
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function featureFlagsForUser(
  userId: number,
): Promise<Record<string, boolean>> {
  const rows = await listFeatureFlagModes();
  const isOwner = rows.some(
    (row) => row.mode === "OWNER_ONLY" || row.mode === "OWNER_AND_QA",
  )
    ? await isFeatureFlagOwnerUser(userId)
    : false;
  const isQa = rows.some((row) => row.mode === "OWNER_AND_QA")
    ? await isFeatureFlagQaUser(userId)
    : false;
  return Object.fromEntries(
    rows.map((row) => [
      row.key,
      featureFlagModeEnabled(row.mode, isOwner, isQa),
    ]),
  );
}

export function validFeatureFlagKey(key: string): boolean {
  return key.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key);
}

export async function setFeatureFlagMode(
  key: string,
  mode: FeatureFlagMode,
): Promise<FeatureFlagRow> {
  if (!validFeatureFlagKey(key) || !FEATURE_FLAG_MODES.includes(mode)) {
    throw new FeatureFlagInputError("Invalid feature flag");
  }
  const declared = (FEATURE_FLAG_KEYS as readonly string[]).includes(key);

  const row = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        CAST(${FEATURE_FLAG_MODE_LOCK_NAMESPACE} AS integer),
        hashtext(${key})
      )
    `;
    const stored = await tx.featureFlag.findUnique({
      where: { key },
      select: { key: true, mode: true, releasedAt: true },
    });
    if (!declared && !stored) throw new FeatureFlagInputError("Unknown feature flag");

    // HTPR-6193: entering EVERYONE restarts the 14-day removal countdown and unlinks the ticket
    // filed for the previous release. Re-filing is still suppressed while the old ticket is open
    // or Keep is on, both by the sweep. Staying on EVERYONE keeps the original date, so
    // re-pressing Everyone cannot extend the clock.
    const entersEveryone = mode === "EVERYONE" && (stored?.mode !== "EVERYONE" || !stored.releasedAt);
    const release = entersEveryone ? { releasedAt: new Date(), removalTaskId: null } : {};

    return tx.featureFlag.upsert({
      where: { key },
      create: { key, mode, ...release },
      update: { mode, ...release },
      select: FEATURE_FLAG_ROW_SELECT,
    });
  });
  return withFeatureFlagMetadata(row, await loadFeatureFlagTicketTitles([key]));
}

/**
 * Pauses or resumes removal for one flag. Keep never moves `releasedAt`, so turning it off
 * resumes the countdown from the original release date, as HTPR-6193 asks.
 */
export async function setFeatureFlagKeep(key: string, keep: boolean): Promise<FeatureFlagRow> {
  if (!validFeatureFlagKey(key)) throw new FeatureFlagInputError("Invalid feature flag");
  const declared = (FEATURE_FLAG_KEYS as readonly string[]).includes(key);
  const stored = await prisma.featureFlag.findUnique({ where: { key }, select: { key: true } });
  if (!declared && !stored) throw new FeatureFlagInputError("Unknown feature flag");

  const [row, ticketTitleByNumber] = await Promise.all([
    prisma.featureFlag.upsert({
      where: { key },
      create: { key, mode: DEFAULT_FEATURE_FLAG_MODE, keep },
      update: { keep },
      select: FEATURE_FLAG_ROW_SELECT,
    }),
    loadFeatureFlagTicketTitles([key]),
  ]);
  return withFeatureFlagMetadata(row, ticketTitleByNumber);
}
