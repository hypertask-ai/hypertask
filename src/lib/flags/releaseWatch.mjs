export const RELEASE_WATCH = Object.freeze({ minimumErrors: 10, multiplier: 2, minimumMinutes: 30, maximumMinutes: 70, watchMinutes: 60 });

export function isReleaseWatchSpike(before, after) {
  return Number.isSafeInteger(before) && before >= 0 && Number.isSafeInteger(after)
    && after >= RELEASE_WATCH.minimumErrors && after > RELEASE_WATCH.multiplier * before;
}
