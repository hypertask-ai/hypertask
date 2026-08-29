// True when an error is a stale-bundle / dynamic-import failure: after a deploy
// the cached HTML points at JS chunks that no longer exist (404), so React
// throws while loading them and the page renders blank. A reload fetches the
// fresh bundle. Used by the root error boundary (PERT-89 white screen).
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  const message = (error as { message?: unknown }).message;
  if (name === "ChunkLoadError") return true;
  if (typeof message !== "string") return false;
  return (
    /Loading chunk [^\s]+ failed/i.test(message) ||
    /Loading CSS chunk [^\s]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}
