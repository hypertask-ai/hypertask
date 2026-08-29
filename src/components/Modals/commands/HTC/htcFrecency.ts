const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export const getHTCFrecencyScore = (
  frequency = 0,
  lastUsedAt?: number,
  now = Date.now()
) => {
  if (frequency <= 0) return 0;

  const age = lastUsedAt ? Math.max(0, now - lastUsedAt) : 0;
  const recencyDecay = Math.pow(0.5, age / FOURTEEN_DAYS_MS);
  return Math.log1p(frequency) * recencyDecay;
};
