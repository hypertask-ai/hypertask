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

function isCurrentSequence(
  latestSequences: Map<string, number>,
  sequence: number,
  keys: readonly string[],
): boolean {
  const latestSequence = Math.max(
    0,
    ...keys.map((key) => latestSequences.get(key) ?? 0),
  );
  return sequence >= latestSequence;
}

export function applySequencedResponse(
  latestSequences: Map<string, number>,
  sequence: number,
  keys: readonly string[],
  apply: () => void,
): boolean {
  if (!isCurrentSequence(latestSequences, sequence, keys)) return false;
  recordSequence(latestSequences, sequence, keys);
  apply();
  return true;
}

export function applySequencedError(
  latestSequences: Map<string, number>,
  sequence: number,
  keys: readonly string[],
  apply: () => void,
): boolean {
  if (!isCurrentSequence(latestSequences, sequence, keys)) return false;
  apply();
  return true;
}
