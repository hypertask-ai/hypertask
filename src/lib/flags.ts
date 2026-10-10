import type {
  FeatureFlagMode as PrismaFeatureFlagMode,
  PrismaClient,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { cache } from "react";
import type { RawFlagMode } from "@/lib/flags/modeCache";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG } from "@/lib/agentRuns/model";
import { FEATURE_FLAG_DEFINITIONS } from "@/lib/flags/definitions";
import { PARKED_FLAGS } from "@/lib/flags/parked";
import type { FeatureFlagDefinition, FeatureFlagKind } from "@/lib/flags/definitions";

import {
  HTPR_7042_NEON_WORK_AVOIDANCE_FLAG,
  HTPR_6951_TASK_WRITING_PROGRESS_FLAG,
  AUTO_TASK_DESCRIPTIONS_FLAG,
  HTPR_6278_CHAT_TURN_FAILURE_FLAG,
  CONFIRMED_PROPOSAL_HEADING_FLAG,
  LOCAL_WRITING_ASSISTANCE_FLAG,
  SHORTCUT_NUDGES_FLAG,
  HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG,
  MY_TASKS_SHORTCUTS_WIDTH_FLAG,
  HTPR_6372_SEARCH_RANKING_FLAG,
  HTPR_6911_SEARCH_ROW_HIGHLIGHT_FLAG,
  HTPR_6516_AGENT_ATTRIBUTION_FLAG,
  HTPR_6512_SEED_TEAM_AGENT_FLAG,
  HTPR_6553_AGENT_CHAT_POLLING_FLAG,
  HTPR_7070_AGENT_CHAT_OWNER_ONLY_FLAG,
} from "@/lib/flags/keys";

// Re-exported so server code keeps importing keys from here. Client components must
// import "@/lib/flags/keys" directly: this module reaches ioredis through the auth
// stack and cannot enter a browser bundle.
export * from "@/lib/flags/keys";
export type { FeatureFlagKind } from "@/lib/flags/definitions";
export function withFeatureFlagSnapshot<T>(run: () => T): T {
  const { withFeatureFlagSnapshot } = require("@/lib/flags/modeCache") as typeof import("@/lib/flags/modeCache");
  return withFeatureFlagSnapshot(run);
}

async function withFlagModeInvalidation<T>(write: () => Promise<T>): Promise<T> {
  if (!process.env.REDIS_URL) return write();
  const { withFlagModeInvalidation } = await import("@/lib/flags/modeCache");
  return withFlagModeInvalidation(write);
}

export const FEATURE_FLAG_OWNER_USER_ID = 6;
// Board writes are never attributed to the owner alone.
export const FEATURE_FLAG_SWEEP_AGENT_ID = "85b985ac-afe8-41a3-a1ac-d9549a9310c7";
const FEATURE_FLAG_OWNER = {
  userId: FEATURE_FLAG_OWNER_USER_ID,
  email: "valentin.yeo@gmail.com",
} as const;
export const FEATURE_FLAG_QA_USER_ID = 985;
export const FEATURE_FLAG_QA_USER = {
  userId: FEATURE_FLAG_QA_USER_ID,
  email: "valentin@hypertask.ai",
} as const;

// Hide and reject retired flags without changing stored rows needed by older deployments.
export const RETIRED_FEATURE_FLAG_KEYS = new Set([
  "htpr-5913-consistent-comment-shortcuts",
  "htpr-6160-inbox-archive-cluster",
  "htpr-6157-new-task-auto-description",
  "htpr-6166-scoped-board-refetch",
  "htpr-6129-mobile-agent-chat-viewport",
  "htpr-6059-lazy-emoji-list",
  "htpr-6322-agent-chat-parked-reply",
  "hyfa-43-factory-owner-preview",
  "htpr-6072-shallow-board-switch",
  "htpr-6254-heic-heif-attachments",
  "htpr-6236-core-actions-smoke",
  "htpr-6035-agent-chat-skills",
  "yper4-123-board-check",
  "yper4-160-flag-pages",
  "htpr-6091-feature-flags",
  "htpr-6133-feature-flag-details",
  "htpr-6176-flag-ticket-title",
  "htpr-6179-flag-sort-filter",
  "htpr-6191-flag-ship-date-clusters",
  "htpr-6193-flag-removal-countdown",
  "htpr-6800-flag-ticket-id",
  "htpr-6653-admin-team-comp",
  "htpr-6118-comment-reactions-api",
  "htpr-6123-add-typescript-agent-sdk",
  "htpr-6124-agent-dev-loop",
  "htpr-6348-agent-access-delegation",
  "htpr-6473-get-agent",
  "htpr-6530-mcp-list-query",
  "htpr-6531-deferred-mcp-tools",
  "htpr-6532-stateless-mcp",
  "htpr-6268-agent-visibility",
  "htpr-6320-ai-observability",
  "htpr-6673-capture-user-signed-up-in-posthog",
]);
// Old tabs read these infra flags as enabled; keep them until old deployments and tabs expire.
// Existing product retirement dates: remove htpr-6072 after 2026-10-06, htpr-6254 and htpr-6035 after 2026-10-16, htpr-6166 after 2026-10-20.
const RETIRED_CLIENT_FEATURE_FLAGS = {
  "htpr-5913-consistent-comment-shortcuts": true,
  "htpr-6091-feature-flags": true,
  "htpr-6133-feature-flag-details": true,
  "htpr-6176-flag-ticket-title": true,
  "htpr-6179-flag-sort-filter": true,
  "htpr-6191-flag-ship-date-clusters": true,
  "htpr-6193-flag-removal-countdown": true,
  "htpr-6800-flag-ticket-id": true,
  "htpr-6653-admin-team-comp": true,
  "htpr-6118-comment-reactions-api": true,
  "htpr-6123-add-typescript-agent-sdk": true,
  "htpr-6124-agent-dev-loop": true,
  "htpr-6348-agent-access-delegation": true,
  "htpr-6473-get-agent": true,
  "htpr-6530-mcp-list-query": true,
  "htpr-6531-deferred-mcp-tools": true,
  "htpr-6532-stateless-mcp": true,
  "htpr-6268-agent-visibility": true,
  "htpr-6320-ai-observability": true,
  "htpr-6673-capture-user-signed-up-in-posthog": true,
  "htpr-6072-shallow-board-switch": true,
  "htpr-6254-heic-heif-attachments": true,
  "htpr-6035-agent-chat-skills": true,
  "htpr-6166-scoped-board-refetch": true,
  "htpr-6129-mobile-agent-chat-viewport": true,
  "htpr-6059-lazy-emoji-list": true,
} as const;

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

export const isFeatureFlagOwnerUser = (
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

/**
 * HTPR-7070: the one server check behind the Agent Chat owner-only boundary.
 * With htpr-7070-agent-chat-owner-only off this allows everyone, which is the
 * access production had before the flag. A request without a session is treated
 * like any other non-owner while the flag is on.
 */
export async function canUseAgentChatUser(userId: number): Promise<boolean> {
  if (!(await isFeatureEnabled(HTPR_7070_AGENT_CHAT_OWNER_ONLY_FLAG, userId))) return true;
  return isFeatureFlagOwnerUser(userId);
}

export async function canUseAgentChat(headers: Headers): Promise<boolean> {
  const session = await getSessionUser(headers);
  // User 0 never exists, so this reads the flag's audience for a signed-out caller.
  return canUseAgentChatUser(session ? session.userId : 0);
}

// Historical bug flags predate kind-based defaults. Classify them for display only:
// adding kind: "bugfix" to their definitions would release missing rows to Everyone.
const LEGACY_BUGFIX_DISPLAY_KINDS: Partial<Record<string, FeatureFlagKind>> = {
  [HTPR_6951_TASK_WRITING_PROGRESS_FLAG]: "bugfix",
  [HTPR_6553_AGENT_CHAT_POLLING_FLAG]: "bugfix",
  [HTPR_6516_AGENT_ATTRIBUTION_FLAG]: "bugfix",
  [HTPR_6512_SEED_TEAM_AGENT_FLAG]: "bugfix",
  [LOCAL_WRITING_ASSISTANCE_FLAG]: "bugfix",
  [HTPR_6278_CHAT_TURN_FAILURE_FLAG]: "bugfix",
  ["htpr-6112-copy-current-url"]: "bugfix",
  [HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG]: "bugfix",
  ["htpr-6363-task-writer-research"]: "bugfix",
  [AUTO_TASK_DESCRIPTIONS_FLAG]: "bugfix",
  [SHORTCUT_NUDGES_FLAG]: "bugfix",
  [CONFIRMED_PROPOSAL_HEADING_FLAG]: "bugfix",
  [MY_TASKS_SHORTCUTS_WIDTH_FLAG]: "bugfix",
  [HTPR_6911_SEARCH_ROW_HIGHLIGHT_FLAG]: "bugfix",
  [HTPR_6372_SEARCH_RANKING_FLAG]: "bugfix",
  ["htpr-6141-ai-first-task-writer"]: "bugfix",
  [AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG]: "bugfix",
};

export type FeatureFlagRow = {
  key: string;
  kind?: FeatureFlagKind;
  related?: readonly string[];
  parked?: { reason: string };
  mode: FeatureFlagMode;
  updatedAt: Date | null;
  releasedAt: Date | null;
  keep: boolean;
  removalTaskId: number | null;
  shippedOn: string | null;
  description: string;
  ticketId: string | null;
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
  const definition: FeatureFlagDefinition | undefined = FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === row.key);
  const ticketNumber = FEATURE_FLAG_KEY_TICKET_NUMBER.exec(row.key)?.[1];
  return {
    ...row,
    kind: definition?.kind ?? LEGACY_BUGFIX_DISPLAY_KINDS[row.key] ?? "feature",
    ...(PARKED_FLAGS[row.key] ? { parked: { reason: PARKED_FLAGS[row.key].reason } } : {}),
    related: definition?.related ? [...(definition.related ?? [])] : undefined,
    description: definition?.description ?? LEGACY_FEATURE_FLAG_DESCRIPTION,
    shippedOn: definition?.shippedOn ?? null,
    ticketId: ticketNumber ? `HTPR-${ticketNumber}` : null,
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

// HTPR-6192: a feature flag with no stored row is on for the owner and QA, never owner-only,
// so the QA agent can verify a feature before Valentin looks at it. Choosing Only me stays possible,
// but it has to be set on the admin page on purpose.
const DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA";
const DEFAULT_BUGFIX_FLAG_MODE: FeatureFlagMode = "EVERYONE";

export function defaultFeatureFlagMode(key: string): FeatureFlagMode {
  const definition: FeatureFlagDefinition | undefined = FEATURE_FLAG_DEFINITIONS.find(({ key: declaredKey }) => declaredKey === key);
  return definition?.defaultMode ?? (definition?.kind === "bugfix"
    ? DEFAULT_BUGFIX_FLAG_MODE
    : DEFAULT_FEATURE_FLAG_MODE);
}

async function loadRawFlagModes(): Promise<RawFlagMode[] | null> {
  if (!process.env.REDIS_URL) return null;
  try {
    const {
      FLAG_MODE_CACHE_KEY, FLAG_MODE_GENERATION_KEY, FLAG_MODE_WRITERS_KEY, flagCacheCommand,
    } = await import("@/lib/flags/modeCache");
    const redis = await flagCacheCommand(import("@/lib/redis").then(({ getRedis }) => getRedis()));
    const [writers, generation, cached] = await flagCacheCommand(redis.mget(
      FLAG_MODE_WRITERS_KEY, FLAG_MODE_GENERATION_KEY, FLAG_MODE_CACHE_KEY,
    ));
    if (writers && writers !== "0") return null;
    let rows: RawFlagMode[];
    if (cached) {
      rows = JSON.parse(cached);
      if (!Array.isArray(rows) || !rows.every((row) =>
        typeof row?.key === "string" && FEATURE_FLAG_MODES.includes(row.mode),
      )) return null;
    } else {
      rows = await prisma.featureFlag.findMany({ select: { key: true, mode: true } });
    }
    const mode = rows.find(({ key }) => key === HTPR_7042_NEON_WORK_AVOIDANCE_FLAG)?.mode
      ?? defaultFeatureFlagMode(HTPR_7042_NEON_WORK_AVOIDANCE_FLAG);
    if (mode !== "EVERYONE") return null;
    if (!cached) {
      // A reader started before an admin write must not refill its invalidated snapshot.
      await flagCacheCommand(redis.eval(`
        if (redis.call('GET', KEYS[1]) or '0') == '0'
          and (redis.call('GET', KEYS[2]) or '0') == ARGV[1] then
          return redis.call('SET', KEYS[3], ARGV[2], 'EX', 30)
        end
        return 0
      `, 3, FLAG_MODE_WRITERS_KEY, FLAG_MODE_GENERATION_KEY, FLAG_MODE_CACHE_KEY,
      generation ?? "0", JSON.stringify(rows))).catch(() => undefined);
    }
    return rows;
  } catch {
    return null;
  }
}

const requestFlagModes = cache(loadRawFlagModes);
async function rawFlagModes(): Promise<RawFlagMode[] | null> {
  if (!process.env.REDIS_URL) return null;
  const { flagModeScope } = await import("@/lib/flags/modeCache");
  const scope = flagModeScope.getStore();
  return scope ? (scope.modes ??= loadRawFlagModes()) : requestFlagModes();
}


/**
 * The user ids a flag can possibly be on for, or null when it is on for
 * everyone. A coarse prefilter only: isFeatureEnabled still decides per user.
 */
export async function featureFlagCandidateUserIds(
  key: string,
  db: FeatureFlagDatabase = prisma,
): Promise<number[] | null> {
  if (RETIRED_FEATURE_FLAG_KEYS.has(key)) return [];
  const modes = db === prisma ? await rawFlagModes() : null;
  const row = modes
    ? modes.find((row) => row.key === key)
    : await db.featureFlag.findUnique({ where: { key }, select: { mode: true } });
  const mode = row?.mode ?? defaultFeatureFlagMode(key);
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
  if (RETIRED_FEATURE_FLAG_KEYS.has(key)) return false;
  const modes = db === prisma ? await rawFlagModes() : null;
  const row = modes
    ? modes.find((row) => row.key === key)
    : await db.featureFlag.findUnique({ where: { key }, select: { mode: true } });
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

export async function listFeatureFlagModes(
  options: { includeTicketTitles?: boolean } = {},
): Promise<FeatureFlagRow[]> {
  const stored = (
    await prisma.featureFlag.findMany({
      select: FEATURE_FLAG_ROW_SELECT,
      orderBy: { key: "asc" },
    })
  ).filter(({ key }) => !RETIRED_FEATURE_FLAG_KEYS.has(key));
  const ticketTitleByNumber = options.includeTicketTitles
    ? await loadFeatureFlagTicketTitles([
        ...new Set([...FEATURE_FLAG_KEYS, ...stored.map(({ key }) => key)]),
      ])
    : new Map<number, string>();
  const byKey = new Map<string, FeatureFlagRow>(
    FEATURE_FLAG_KEYS.map((key) => [
      key,
      withFeatureFlagMetadata(
        { key, mode: defaultFeatureFlagMode(key), updatedAt: null, releasedAt: null, keep: false, removalTaskId: null },
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
  const modes = await rawFlagModes();
  const rows = modes
    ? [...new Map([
        ...FEATURE_FLAG_KEYS.map((key) => [key, { key, mode: defaultFeatureFlagMode(key) }] as const),
        ...modes.filter(({ key }) => !RETIRED_FEATURE_FLAG_KEYS.has(key)).map((row) => [row.key, row] as const),
      ]).values()].sort((a, b) => a.key.localeCompare(b.key))
    : await listFeatureFlagModes();
  const isOwner = rows.some(
    (row) => row.mode === "OWNER_ONLY" || row.mode === "OWNER_AND_QA",
  )
    ? await isFeatureFlagOwnerUser(userId)
    : false;
  const isQa = rows.some((row) => row.mode === "OWNER_AND_QA")
    ? await isFeatureFlagQaUser(userId)
    : false;
  return {
    ...Object.fromEntries(
      rows.map((row) => [
        row.key,
        featureFlagModeEnabled(row.mode, isOwner, isQa),
      ]),
    ),
    ...RETIRED_CLIENT_FEATURE_FLAGS,
  };
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
  if (RETIRED_FEATURE_FLAG_KEYS.has(key)) {
    throw new FeatureFlagInputError("Unknown feature flag");
  }
  const declared = (FEATURE_FLAG_KEYS as readonly string[]).includes(key);

  const row = await withFlagModeInvalidation(() => prisma.$transaction(async (tx) => {
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
  }));
  return withFeatureFlagMetadata(row, await loadFeatureFlagTicketTitles([key]));
}

/**
 * Pauses or resumes removal for one flag. Keep never moves `releasedAt`, so turning it off
 * resumes the countdown from the original release date, as HTPR-6193 asks.
 */
export async function setFeatureFlagKeep(key: string, keep: boolean): Promise<FeatureFlagRow> {
  if (!validFeatureFlagKey(key)) throw new FeatureFlagInputError("Invalid feature flag");
  if (RETIRED_FEATURE_FLAG_KEYS.has(key)) throw new FeatureFlagInputError("Unknown feature flag");
  const declared = (FEATURE_FLAG_KEYS as readonly string[]).includes(key);
  const stored = await prisma.featureFlag.findUnique({ where: { key }, select: { key: true } });
  if (!declared && !stored) throw new FeatureFlagInputError("Unknown feature flag");

  const [row, ticketTitleByNumber] = await Promise.all([
    withFlagModeInvalidation(() => prisma.featureFlag.upsert({
      where: { key },
      create: { key, mode: defaultFeatureFlagMode(key), keep },
      update: { keep },
      select: FEATURE_FLAG_ROW_SELECT,
    })),
    loadFeatureFlagTicketTitles([key]),
  ]);
  return withFeatureFlagMetadata(row, ticketTitleByNumber);
}
