function recordSequence(
  latestSequences: Map<string, number>,
  sequence: number,
  keys: readonly string[],
): void {
  keys.forEach((key) => {
    if (sequence > (latestSequences.get(key) ?? 0)) {
      latestSequences.set(key, sequence);
    }
  });
}

export function invalidateSequencedResponse(
  latestSequences: Map<string, number>,
  sequence: number,
  keys: readonly string[],
): void {
  recordSequence(latestSequences, sequence, keys);
}

export function applySequencedResponse(
  latestSequences: Map<string, number>,
  sequence: number,
  keys: readonly string[],
  apply: () => void,
): boolean {
  const latestSequence = Math.max(
    0,
    ...keys.map((key) => latestSequences.get(key) ?? 0),
  );
  if (sequence < latestSequence) return false;
  recordSequence(latestSequences, sequence, keys);
  apply();
  return true;
}
