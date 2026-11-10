const buckets = new Map<string, { windowStart: number; count: number }>();
const MAX_BUCKETS = 5000;

export function consumeLocalWindow(key: string, windowSeconds: number, now = Date.now()): number {
  const seconds = Math.floor(now / 1000);
  const windowStart = Math.floor(seconds / windowSeconds) * windowSeconds;
  const bucket = buckets.get(key);
  if (!bucket || bucket.windowStart !== windowStart) {
    if (buckets.size >= MAX_BUCKETS) buckets.clear();
    buckets.set(key, { windowStart, count: 1 });
    return 1;
  }
  bucket.count += 1;
  return bucket.count;
}

export function clearLocalWindows(): void {
  buckets.clear();
}
