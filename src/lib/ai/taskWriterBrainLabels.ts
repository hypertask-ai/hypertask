export const BRAIN_LABEL_NAMES = ["brain-light", "brain-medium", "brain-hard", "brain-extra-hard"] as const;
export const DEFAULT_BRAIN_LABEL_NAME = "brain-medium";

export type TaskWriterBrainLabels = {
  ids: ReadonlySet<string>;
  defaultId: string | null;
  options: readonly { id: string; name: string }[];
};

const normalize = (value: string | null) => (value ?? "").trim().toLowerCase();

export function brainLabelsFromBoard(labels: readonly { id: string; value: string | null }[]): TaskWriterBrainLabels | null {
  const brain = labels.filter((label) => (BRAIN_LABEL_NAMES as readonly string[]).includes(normalize(label.value)));
  if (!brain.length) return null;
  return {
    ids: new Set(brain.map((label) => label.id)),
    defaultId: brain.find((label) => normalize(label.value) === DEFAULT_BRAIN_LABEL_NAME)?.id ?? null,
    options: BRAIN_LABEL_NAMES.flatMap((name) => {
      const match = brain.find((label) => normalize(label.value) === name);
      return match ? [{ id: match.id, name }] : [];
    }),
  };
}

export function enforceBrainLabel(ids: readonly string[], brain: TaskWriterBrainLabels | null | undefined): string[] {
  const unique = [...new Set(ids)];
  if (!brain) return unique;
  const chosen = unique.find((id) => brain.ids.has(id)) ?? brain.defaultId;
  const rest = unique.filter((id) => !brain.ids.has(id));
  return chosen ? [...rest, chosen] : rest;
}

export function taskWriterBrainRule(brain: TaskWriterBrainLabels): string {
  const labels = JSON.stringify(brain.options);
  return `This board has brain labels (${brain.options.map((option) => option.name).join(", ")}). The user does not have to name tags: always pick exactly one brain label for the ticket from how hard the work is, and always put its ID, only the ID and never the name, in the tags. Brain labels: ${labels}. brain-light is a tiny fix in one file, such as a typo, a wording change or a one-line tweak. brain-medium is the default for normal work. brain-hard is a hard bug, security, money, payments, data loss or many systems. brain-extra-hard is rare, auth or security together with money. If you are unsure between medium and hard, pick brain-medium. Never pick two brain labels. Other labels still follow the rules above: only add one when it clearly fits.`;
}
