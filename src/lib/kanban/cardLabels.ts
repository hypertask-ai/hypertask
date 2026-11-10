export const HIDDEN_CARD_LABELS: readonly RegExp[] = [/^brain-/i, /^design-pass$/i];
export const MAX_CARD_LABELS = 2;

const TYPE_LABEL = /^\W*(bug|improvement|feature)\b/i;

export function cardLabels<T>(items: readonly T[], valueOf: (item: T) => string): { shown: T[]; more: number } {
  const visible = items.filter((item) => {
    const value = valueOf(item).trim();
    return value !== "" && !HIDDEN_CARD_LABELS.some((pattern) => pattern.test(value));
  });
  const isType = (item: T) => TYPE_LABEL.test(valueOf(item).trim());
  const ordered = [...visible.filter(isType), ...visible.filter((item) => !isType(item))];
  return { shown: ordered.slice(0, MAX_CARD_LABELS), more: Math.max(0, ordered.length - MAX_CARD_LABELS) };
}
