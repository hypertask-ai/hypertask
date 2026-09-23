// Appends `realtime=on`, the same query param src/lib/realtime/client.ts
// already reads to opt a browser context back into live Pusher sync. Native
// here means every e2e/smoke navigation carries it by default, instead of
// hypertask-qa-runner's scripts/patch-realtime.mjs editing the checkout
// after every git fetch (see that repo's README, "The ?realtime=on patch").
//
// Note: src/lib/realtime/client.ts currently checks navigator.webdriver
// BEFORE this query param, so Playwright's own Chromium (which always
// reports navigator.webdriver === true) still gets realtime disabled, this
// helper doesn't change that. It matters for non-automated contexts today,
// and for automated ones too if that check order ever changes. None of the
// journeys in this suite depend on live push: they reload and re-read from
// the server instead.
export function withRealtime(pathOrUrl: string): string {
  return pathOrUrl + (pathOrUrl.includes('?') ? '&' : '?') + 'realtime=on'
}
