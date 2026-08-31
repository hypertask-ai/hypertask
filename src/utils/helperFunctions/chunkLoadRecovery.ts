export const CHUNK_RELOAD_STORAGE_KEY = "ht-chunk-reload";
export const CHUNK_RELOAD_PARAM = "__ht_chunk_reload";

const RELOAD_PREFLIGHT_TIMEOUT_MS = 8 * 1000;

export function nextChunkRecoveryAttempt(rawTries: string | null, maxTries = 2) {
  const parsed = Number.parseInt(rawTries ?? "0", 10);
  const tries = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  return tries < maxTries ? tries + 1 : null;
}

export function buildChunkRecoveryUrl(
  href: string,
  attempt: number,
  nonce = Date.now()
) {
  const url = new URL(href);
  url.searchParams.set(CHUNK_RELOAD_PARAM, `${attempt}-${nonce}`);
  return url.toString();
}

export function stripChunkRecoveryParam(href: string) {
  const url = new URL(href);
  if (!url.searchParams.has(CHUNK_RELOAD_PARAM)) return null;
  url.searchParams.delete(CHUNK_RELOAD_PARAM);
  return url.toString();
}

// Reloading the native Android WebView is a one-way door: if the network is
// sleeping, Chromium can replace the app with an error interstitial that has no
// useful navigation controls. Web browsers retain their own retry controls, so
// do not let a second network timeout prevent their cache-busted recovery.
export async function canReachPage(
  url: string,
  timeoutMs = RELOAD_PREFLIGHT_TIMEOUT_MS
) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return false;
  }
  if (
    typeof navigator === "undefined" ||
    !/\bHypertaskApp\b/.test(navigator.userAgent)
  ) {
    return true;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "reload",
      credentials: "same-origin",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
