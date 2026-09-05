import type {
  FeatureFlagMode as PrismaFeatureFlagMode,
  PrismaClient,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG } from "@/lib/agentRuns/model";

export const FEATURE_FLAG_OWNER_USER_ID = 6;
export const FEATURE_FLAG_QA_USER_ID = 985;
const FEATURE_FLAG_OWNER = {
  userId: FEATURE_FLAG_OWNER_USER_ID,
  email: "valentin.yeo@gmail.com",
} as const;
const FEATURE_FLAG_QA_USER = {
  userId: FEATURE_FLAG_QA_USER_ID,
  email: "valentin@hypertask.ai",
} as const;

export const FEATURE_FLAG_DETAILS_FLAG = "htpr-6133-feature-flag-details";
export const AGENT_CHAT_BRIEF_FLAG = "htpr-6155-chat-agent-brief";
export const AGENT_CHAT_TICKET_CONFIRM_FLAG = "htpr-6006-chat-confirm-ticket";

const FEATURE_FLAG_DEFINITIONS = [
  {
    key: "htpr-5913-consistent-comment-shortcuts",
    description:
      "Makes comment shortcuts consistent: Ctrl+Enter sends and moves on, while Ctrl+Shift+Enter sends and stays.",
  },
  {
    key: "htpr-5992-mobile-all-tasks",
    description: "Shows the redesigned All Tasks view on mobile devices.",
  },
  {
    key: "htpr-5993-optimistic-task-uploads",
    description: "Saves new tasks immediately while their attachments continue uploading.",
  },
  {
    key: AGENT_CHAT_TICKET_CONFIRM_FLAG,
    description: "Requires a confirmed board ticket before Agent Chat can start side-effecting work.",
  },
  {
    key: "htpr-6072-shallow-board-switch",
    description: "Switches between cached boards without remounting the whole board screen.",
  },
  {
    key: "htpr-6091-feature-flags",
    description:
      "Registers the feature flag controls themselves; the owner-only admin page stays available in every mode.",
  },
  {
    key: "htpr-6094-agent-activity-rows",
    description: "Shows passive ticket progress between normal messages in Agent Chat.",
  },
  {
    key: "htpr-6112-copy-current-url",
    description: "Adds a Copy current URL action to the command menu.",
  },
  {
    key: "htpr-6115-agent-sdk",
    description: "Enables the shared Agent SDK run model and lifecycle endpoints.",
  },
  {
    key: "htpr-6116-figma-node-preview",
    description: "Shows a preview of Figma file contents instead of the file cover image.",
  },
  {
    key: "htpr-6118-comment-reactions-api",
    description: "Lets agents add and remove emoji reactions on comments through the API and CLI.",
  },
  {
    key: "htpr-6122-agent-run-activities",
    description: "Enables typed thought, action, response, error, and question updates for agent runs.",
  },
  {
    key: "htpr-6123-add-typescript-agent-sdk",
    description: "Allows the TypeScript Agent SDK to read and update agent runs.",
  },
  {
    key: "htpr-6129-mobile-agent-chat-viewport",
    description: "Keeps the full Agent Chat visible on mobile when the keyboard is open.",
  },
  {
    key: "htpr-6130-mobile-reminder-safe-area",
    description: "Keeps the mobile reminder time selector aligned and clear of bottom controls.",
  },
  {
    key: FEATURE_FLAG_DETAILS_FLAG,
    description: "Shows a plain-language description and ticket link for every feature flag.",
  },
  {
    key: "htpr-6141-ai-first-task-writer",
    description: "Opens the AI task writer from a column plus instead of the classic new-task form.",
  },
  {
    key: AGENT_CHAT_BRIEF_FLAG,
    description:
      "Gives Agent Chat a bounded snapshot of each agent's current and recent work.",
  },
  {
    key: AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG,
    description: "Lets people stop stuck Agent Chat turns and ends unanswered turns after five minutes.",
  },
] as const satisfies readonly { key: string; description: string }[];

export const FEATURE_FLAG_KEYS = FEATURE_FLAG_DEFINITIONS.map(({ key }) => key);
const OWNER_ONLY_BY_DEFAULT = new Set<string>([
  AGENT_CHAT_TICKET_CONFIRM_FLAG,
  "htpr-6072-shallow-board-switch",
  "htpr-6094-agent-activity-rows",
  "htpr-6122-agent-run-activities",
  "htpr-6123-add-typescript-agent-sdk",
  "htpr-6129-mobile-agent-chat-viewport",
  "htpr-6130-mobile-reminder-safe-area",
  FEATURE_FLAG_DETAILS_FLAG,
  "htpr-6141-ai-first-task-writer",
  AGENT_CHAT_BRIEF_FLAG,
  AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG,
]);
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
  description: string;
  ticketUrl: string | null;
};

const FEATURE_FLAG_TICKET_BASE = "https://app.hypertask.ai/detail/project-15";
const LEGACY_FEATURE_FLAG_DESCRIPTION =
  "This older feature flag has no description in this version of the app.";

function withFeatureFlagMetadata(
  row: Pick<FeatureFlagRow, "key" | "mode" | "updatedAt">,
): FeatureFlagRow {
  const definition = FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === row.key);
  const ticketNumber = /^htpr-([1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(row.key)?.[1];
  return {
    ...row,
    description: definition?.description ?? LEGACY_FEATURE_FLAG_DESCRIPTION,
    ticketUrl: ticketNumber ? `${FEATURE_FLAG_TICKET_BASE}/${ticketNumber}` : null,
  };
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

const defaultFeatureFlagMode = (key: string): FeatureFlagMode =>
  OWNER_ONLY_BY_DEFAULT.has(key) ? "OWNER_ONLY" : "OWNER_AND_QA";

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
  const mode = row?.mode ?? defaultFeatureFlagMode(key);
  const includesOwner = mode === "OWNER_ONLY" || mode === "OWNER_AND_QA";
  return featureFlagModeEnabled(
    mode,
    includesOwner && (await isFeatureFlagOwnerUser(userId, db)),
    mode === "OWNER_AND_QA" && (await isFeatureFlagQaUser(userId, db)),
  );
}

export async function listFeatureFlagModes(): Promise<FeatureFlagRow[]> {
  const stored = await prisma.featureFlag.findMany({
    select: { key: true, mode: true, updatedAt: true },
    orderBy: { key: "asc" },
  });
  const byKey = new Map<string, FeatureFlagRow>(
    FEATURE_FLAG_KEYS.map((key) => [
      key,
      withFeatureFlagMetadata({ key, mode: defaultFeatureFlagMode(key), updatedAt: null }),
    ]),
  );
  stored.forEach((row) => byKey.set(row.key, withFeatureFlagMetadata(row)));
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
  const existing = declared
    ? true
    : Boolean(await prisma.featureFlag.findUnique({ where: { key }, select: { key: true } }));
  if (!existing) throw new FeatureFlagInputError("Unknown feature flag");

  const row = await prisma.featureFlag.upsert({
    where: { key },
    create: { key, mode },
    update: { mode },
    select: { key: true, mode: true, updatedAt: true },
  });
  return withFeatureFlagMetadata(row);
}
