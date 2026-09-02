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

export interface CreateAutoDescriptionEligibility {
  enabled: boolean;
  isDesktop: boolean;
  title?: string | null;
  description?: string | null;
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

export function hasMeaningfulDescriptionSuggestionTitle(
  title?: string | null,
) {
  const words = title?.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length >= 3;
}

export function shouldSuggestCreateDescription(
  input: CreateAutoDescriptionEligibility,
) {
  return (
    input.enabled &&
    input.isDesktop &&
    input.preferencesHydrated &&
    !input.dismissed &&
    hasMeaningfulDescriptionSuggestionTitle(input.title) &&
    !hasDescriptionContent(input.description)
  );
}

export function canApplyCreateDescriptionSuggestion(
  expectedTitle: string,
  currentTitle: string,
  currentDescription: string,
  enabled: boolean,
  dismissed: boolean,
) {
  return (
    expectedTitle === currentTitle.trim() &&
    shouldSuggestCreateDescription({
      enabled,
      isDesktop: true,
      title: currentTitle,
      description: currentDescription,
      preferencesHydrated: true,
      dismissed,
    })
  );
}
