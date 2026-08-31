export function applySequencedResponse(
  appliedSequences: Map<string, number>,
  sequence: number,
  keys: readonly string[],
  apply: () => void,
): boolean {
  const appliedSequence = Math.max(
    0,
    ...keys.map((key) => appliedSequences.get(key) ?? 0),
  );
  if (sequence < appliedSequence) return false;
  keys.forEach((key) => appliedSequences.set(key, sequence));
  apply();
  return true;
}
