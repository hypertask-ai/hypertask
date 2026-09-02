const STORAGE_KEY_PREFIX = "hypertask:auto-description-dismissed";
const MAX_DISMISSED_TASKS = 100;

export const AUTO_DESCRIPTION_SUGGESTION_DELAY_MS = 5_000;

export function buildTaskWriterPrompt(
  prompt: string,
  taskTitle?: string | null,
) {
  return taskTitle
    ? `This task has title: ${taskTitle}. Keep this in major consideration when creating title and description, improve it rather than just copy pasting\n${prompt}`
    : prompt;
}

export function resolveTaskWriterSubmitPrompt(
  autoTrigger: boolean,
  presentation: "overlay" | "description-suggestion",
  initialPrompt: string,
  userPrompt: string,
) {
  return autoTrigger && presentation === "overlay" ? initialPrompt : userPrompt;
}

export interface AutoDescriptionTakeover {
  before: string;
  inserted: string;
}

export interface AutoDescriptionEligibility {
  enabled: boolean;
  isDesktop: boolean;
  title?: string | null;
  savedDescription?: string | null;
  draftDescription?: string | null;
  draftsHydrated: boolean;
  preferencesHydrated: boolean;
  dismissed: boolean;
}

const DESCRIPTION_MEDIA_RE = /<(?:audio|embed|iframe|img|object|video)\b/i;
const ZERO_WIDTH_RE =
  /[\u200B-\u200D\uFEFF]|&(?:#(?:8203|8204|8205|65279)|#x(?:200B|200C|200D|FEFF)|ZeroWidthSpace);/gi;

export function hasDescriptionContent(value?: string | null) {
  if (!value) return false;
  if (DESCRIPTION_MEDIA_RE.test(value)) return true;
  return Boolean(
    value
      .replace(ZERO_WIDTH_RE, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&(?:nbsp|#160|#xA0);/gi, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export function canTakeOverDescription(currentHtml: string) {
  return !hasDescriptionContent(currentHtml);
}

export function canUndoDescriptionTakeover(
  currentHtml: string,
  takeover: AutoDescriptionTakeover,
) {
  return currentHtml === takeover.inserted;
}

export function mergeDescriptionTakeoverAttachments<TExisting, TGenerated>(
  existing: readonly TExisting[],
  generated: readonly TGenerated[],
) {
  return [...existing, ...generated];
}

export function snapshotDescriptionAttachments(attachments: readonly unknown[]) {
  return JSON.stringify(
    attachments.map((attachment) => {
      const item =
        attachment && typeof attachment === "object"
          ? (attachment as Record<string, unknown>)
          : {};
      const file =
        item.file && typeof item.file === "object"
          ? (item.file as Record<string, unknown>)
          : item;
      return [file.id, file.name, file.size, file.type, file.source];
    }),
  );
}

export function shouldSuggestDescription(input: AutoDescriptionEligibility) {
  return (
    input.enabled &&
    input.isDesktop &&
    input.draftsHydrated &&
    input.preferencesHydrated &&
    !input.dismissed &&
    Boolean(input.title?.trim()) &&
    !hasDescriptionContent(input.savedDescription) &&
    !hasDescriptionContent(input.draftDescription)
  );
}

function storageKey(userId: number) {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

function readDismissed(storage: Storage, userId: number) {
  const key = storageKey(userId);
  const stored = storage.getItem(key);
  let value: unknown;
  try {
    value = JSON.parse(stored ?? "[]");
  } catch {
    storage.removeItem(key);
    return [];
  }
  if (!Array.isArray(value)) {
    storage.removeItem(key);
    return [];
  }
  return value.filter(
    (taskId): taskId is number => Number.isInteger(taskId) && taskId > 0,
  ).slice(-MAX_DISMISSED_TASKS);
}

export function isDescriptionSuggestionDismissed(
  storage: Storage,
  userId: number,
  taskId: number,
) {
  try {
    return readDismissed(storage, userId).includes(taskId);
  } catch {
    return true;
  }
}

export function dismissDescriptionSuggestion(
  storage: Storage,
  userId: number,
  taskId: number,
) {
  try {
    const previous = readDismissed(storage, userId).filter((id) => id !== taskId);
    storage.setItem(
      storageKey(userId),
      JSON.stringify([...previous, taskId].slice(-MAX_DISMISSED_TASKS)),
    );
    return true;
  } catch {
    return false;
  }
}
