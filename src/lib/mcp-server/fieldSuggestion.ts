export type FieldSuggestions = Record<string, string>;

const MAX_DISTANCE = 2;
const SHORT_KEY_LENGTH = 4;

const editDistance = (left: string, right: string): number => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
};

export const suggestKnownFields = (
  unknownKeys: readonly string[],
  knownFields: readonly string[],
): FieldSuggestions => {
  const suggestions: FieldSuggestions = {};
  for (const unknownKey of unknownKeys) {
    const needle = unknownKey.toLowerCase();
    const limit = needle.length < SHORT_KEY_LENGTH ? 1 : MAX_DISTANCE;
    let best: string | null = null;
    let bestDistance = limit + 1;
    let tied = false;
    for (const field of knownFields) {
      if (field === unknownKey) continue;
      const distance = editDistance(needle, field.toLowerCase());
      if (distance < bestDistance) {
        best = field;
        bestDistance = distance;
        tied = false;
      } else if (distance === bestDistance) {
        tied = true;
      }
    }
    if (best !== null && bestDistance <= limit && !tied) suggestions[unknownKey] = best;
  }
  return suggestions;
};

export const describeFieldSuggestions = (suggestions: FieldSuggestions): string =>
  Object.entries(suggestions)
    .map(([unknownKey, knownField]) => `Did you mean ${knownField} instead of ${unknownKey}?`)
    .join(' ');
