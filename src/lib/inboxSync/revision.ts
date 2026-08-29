export type InboxReadModelRevision = `${string}:${string}`;

const REVISION_PATTERN = /^\d{16}:[a-f0-9]{32}$/;
const latestRevisionByAccount = new Map<number, InboxReadModelRevision>();
const REVISION_MESSAGE_TYPE = "inbox-read-model-revision";
const REVISION_STORAGE_PREFIX = "hypertask-inbox-read-model-revision";

const storedRevisionKeyPrefix = (accountId: number): string =>
  `${REVISION_STORAGE_PREFIX}:${accountId}`;

const storedRevisionKey = (accountId: number, tabId: string): string =>
  `${storedRevisionKeyPrefix(accountId)}:${tabId}`;

const readStoredRevision = (
  accountId: number,
): InboxReadModelRevision | null => {
  if (typeof window === "undefined") return null;
  try {
    const prefix = storedRevisionKeyPrefix(accountId);
    let latest: InboxReadModelRevision | null = null;
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key !== prefix && !key?.startsWith(`${prefix}:`)) continue;
      const revision = window.localStorage.getItem(key);
      if (
        isInboxReadModelRevision(revision) &&
        (latest === null ||
          compareInboxReadModelRevisions(revision, latest) > 0)
      ) {
        latest = revision;
      }
    }
    return latest;
  } catch {
    return null;
  }
};

const writeStoredRevision = (
  accountId: number,
  tabId: string,
  revision: InboxReadModelRevision,
): void => {
  if (typeof window === "undefined") return;
  try {
    const key = storedRevisionKey(accountId, tabId);
    const current = window.localStorage.getItem(key);
    if (
      !isInboxReadModelRevision(current) ||
      compareInboxReadModelRevisions(revision, current) > 0
    ) {
      // Each tab owns one key. Concurrent tabs cannot overwrite a newer
      // revision written by another tab with an older value.
      window.localStorage.setItem(key, revision);
    }
    const latest = readStoredRevision(accountId);
    if (latest === null) return;
    const prefix = storedRevisionKeyPrefix(accountId);
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const candidateKey = window.localStorage.key(index);
      if (
        candidateKey !== prefix &&
        !candidateKey?.startsWith(`${prefix}:`)
      ) {
        continue;
      }
      const candidate = window.localStorage.getItem(candidateKey);
      if (
        isInboxReadModelRevision(candidate) &&
        compareInboxReadModelRevisions(candidate, latest) < 0
      ) {
        window.localStorage.removeItem(candidateKey);
      }
    }
  } catch {
    // Browsers can deny storage. The caller keeps the late IndexedDB check.
  }
};

const randomTabId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replaceAll("-", "");
  }
  let id = "";
  for (let index = 0; index < 32; index += 1) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return id;
};

const getTabId = (() => {
  let memoryTabId: string | null = null;
  return (): string => (memoryTabId ??= randomTabId());
})();

const epochMicroseconds = (): number => {
  if (
    typeof performance !== "undefined" &&
    Number.isFinite(performance.timeOrigin) &&
    Number.isFinite(performance.now())
  ) {
    return Math.floor((performance.timeOrigin + performance.now()) * 1_000);
  }
  return Date.now() * 1_000;
};

const revisionTime = (revision: InboxReadModelRevision | null): number =>
  revision ? Number.parseInt(revision.slice(0, 16), 10) : 0;

export const isInboxReadModelRevision = (
  value: unknown,
): value is InboxReadModelRevision =>
  typeof value === "string" && REVISION_PATTERN.test(value);

const revisionChannel = (() => {
  if (
    typeof window === "undefined" ||
    typeof window.BroadcastChannel === "undefined"
  ) {
    return null;
  }
  try {
    const channel = new window.BroadcastChannel(
      "hypertask-inbox-read-model-revisions",
    );
    channel.addEventListener("message", (event) => {
      const message = event.data as {
        type?: unknown;
        accountId?: unknown;
        revision?: unknown;
      };
      if (
        message?.type !== REVISION_MESSAGE_TYPE ||
        typeof message.accountId !== "number" ||
        !Number.isInteger(message.accountId) ||
        message.accountId <= 0 ||
        !isInboxReadModelRevision(message.revision)
      ) {
        return;
      }
      observeInboxReadModelRevision(message.accountId, message.revision);
    });
    return channel;
  } catch {
    return null;
  }
})();

export const inboxRevisionStorageAvailable = (accountId: number): boolean => {
  const storedRevision = readStoredRevision(accountId);
  const observedRevision = latestRevisionByAccount.get(accountId);
  return (
    storedRevision !== null &&
    (observedRevision === undefined ||
      compareInboxReadModelRevisions(storedRevision, observedRevision) >= 0)
  );
};

export const clearInboxReadModelRevisionStorage = (): void => {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(`${REVISION_STORAGE_PREFIX}:`)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // IndexedDB cleanup still proceeds when localStorage is unavailable.
  }
};

export const compareInboxReadModelRevisions = (
  left: InboxReadModelRevision,
  right: InboxReadModelRevision,
): number => (left === right ? 0 : left < right ? -1 : 1);

export const observeInboxReadModelRevision = (
  accountId: number,
  revision: InboxReadModelRevision,
): void => {
  const current = latestRevisionByAccount.get(accountId);
  if (!current || compareInboxReadModelRevisions(revision, current) > 0) {
    latestRevisionByAccount.set(accountId, revision);
  }
};

export const createInboxReadModelRevision = ({
  operationTime,
  tabId,
  previousRevision = null,
}: {
  operationTime: number;
  tabId: string;
  previousRevision?: InboxReadModelRevision | null;
}): InboxReadModelRevision => {
  const logicalTime = Math.max(
    Math.floor(operationTime),
    revisionTime(previousRevision) + 1,
  );
  return `${String(logicalTime).padStart(16, "0")}:${tabId}`;
};

export const reserveInboxReadModelRevision = (
  accountId: number,
): InboxReadModelRevision => {
  const previousRevision = currentInboxReadModelRevision(accountId);
  const tabId = getTabId();
  const revision = createInboxReadModelRevision({
    operationTime: epochMicroseconds(),
    previousRevision,
    tabId,
  });
  observeInboxReadModelRevision(accountId, revision);
  // localStorage updates synchronously across same-origin tabs. This small
  // revision-only fence closes the delivery gap left by BroadcastChannel
  // without copying Inbox content or user-local view state.
  writeStoredRevision(accountId, tabId, revision);
  revisionChannel?.postMessage({
    type: REVISION_MESSAGE_TYPE,
    accountId,
    revision,
  });
  return revision;
};

export const currentInboxReadModelRevision = (
  accountId: number,
): InboxReadModelRevision | null => {
  const storedRevision = readStoredRevision(accountId);
  if (storedRevision) observeInboxReadModelRevision(accountId, storedRevision);
  return latestRevisionByAccount.get(accountId) ?? null;
};
