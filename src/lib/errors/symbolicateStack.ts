import {
  decodedMappings,
  originalPositionFor,
  TraceMap,
} from "@jridgewell/trace-mapping";

const MAX_FRAMES = 40;
const MAX_MAPS_PER_STACK = 4;
const MAX_MAP_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 4000;
const NEGATIVE_CACHE_MS = 30_000;
const MAX_MAP_WAITERS = 16;
const mapWaiters: Array<() => void> = [];
let activeMapLoads = 0;

const mapCache = new Map<string, Promise<TraceMap | null>>();
const inFlightMaps = new Map<string, Promise<TraceMap | null>>();
async function withMapSlot<T>(work: () => Promise<T>) {
  if (activeMapLoads >= MAX_MAPS_PER_STACK) {
    if (mapWaiters.length >= MAX_MAP_WAITERS) return null;
    await new Promise<void>((resolve) => mapWaiters.push(resolve));
  } else activeMapLoads += 1;
  try {
    return await work();
  } finally {
    const next = mapWaiters.shift();
    if (next) next();
    else activeMapLoads -= 1;
  }
}

export function decodeSourceMap(raw: string): TraceMap | null {
  try {
    const map = new TraceMap(JSON.parse(raw));
    decodedMappings(map); // Validate lazy VLQ mappings before caching them.
    return map;
  } catch {
    return null;
  }
}

function normalizeSourcePath(source: string) {
  const withoutLoader = source.slice(source.lastIndexOf("!") + 1);
  return withoutLoader
    .replace(/^webpack:\/\/(_N_E)?\//, "")
    .replace(/^\.\//, "");
}

function allowedOrigins() {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.SOURCE_MAP_ORIGIN,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
    "https://app.hypertask.ai",
    "https://app.hypertasks.ai",
  ];
  const origins = new Set<string>();
  for (const value of configured) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // A malformed configured origin is not trusted.
    }
  }
  return origins;
}

function isAllowedScript(scriptUrl: string, origins: Set<string>) {
  try {
    const url = new URL(scriptUrl);
    return (
      url.protocol === "https:" &&
      origins.has(url.origin) &&
      url.pathname.startsWith("/_next/") &&
      url.pathname.endsWith(".js")
    );
  } catch {
    return false;
  }
}

function sourceMapHeaders(mapUrl: string) {
  const secret = process.env.SOURCE_MAP_BYPASS_SECRET;
  if (!secret) return undefined;
  const origins = new Set([
    "https://app.hypertask.ai",
    "https://app.hypertasks.ai",
    process.env.SOURCE_MAP_BYPASS_ORIGIN,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ]);
  if (!origins.has(new URL(mapUrl).origin)) return undefined;
  return { "x-vercel-protection-bypass": secret };
}

async function readBoundedMap(response: Response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_MAP_BYTES) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_MAP_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

async function loadMap(
  scriptUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TraceMap | null> {
  const url = new URL(scriptUrl);
  url.pathname += ".map";
  url.search = "";
  url.hash = "";
  const mapUrl = url.toString();

  const cached = mapCache.get(mapUrl);
  if (cached) {
    mapCache.delete(mapUrl);
    mapCache.set(mapUrl, cached);
    return cached;
  }
  const pending = inFlightMaps.get(mapUrl);
  if (pending) return pending;

  const loading = withMapSlot(async () => {
    try {
      const response = await fetchImpl(mapUrl, {
        cache: "no-store",
        headers: sourceMapHeaders(mapUrl),
        redirect: "error",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const raw = await readBoundedMap(response);
      return raw ? decodeSourceMap(raw) : null;
    } catch {
      return null;
    }
  });
  inFlightMaps.set(mapUrl, loading);
  const map = await loading;
  if (inFlightMaps.get(mapUrl) === loading) inFlightMaps.delete(mapUrl);
  if (mapCache.size >= MAX_MAPS_PER_STACK) {
    const oldest = mapCache.keys().next().value;
    if (oldest !== undefined) mapCache.delete(oldest);
  }
  mapCache.set(mapUrl, loading);
  if (!map) {
    setTimeout(() => {
      if (mapCache.get(mapUrl) === loading) mapCache.delete(mapUrl);
    }, NEGATIVE_CACHE_MS).unref();
  }
  return map;
}

const FRAME =
  /(https?:\/\/[^\s()]+?\.js(?:\?[^\s()]*)?(?:#[^\s()]*)?):(\d+):(\d+)/g;

export type SymbolicateResult = { stack: string; resolvedFrames: number };

export async function symbolicateStack(
  stack: string | undefined,
  options: {
    fetchMap?: (scriptUrl: string) => Promise<TraceMap | null>;
    fetchImpl?: typeof fetch;
    origins?: Set<string>;
  } = {},
): Promise<SymbolicateResult> {
  if (!stack) return { stack: "", resolvedFrames: 0 };

  const boundedStack = stack.slice(0, 8000);
  const origins = options.origins ?? allowedOrigins();
  const frames = [...boundedStack.matchAll(FRAME)]
    .map((match) => ({
      match: match[0],
      index: match.index!,
      url: match[1],
      line: Number(match[2]),
      column: Number(match[3]),
    }))
    .filter((frame) => isAllowedScript(frame.url, origins))
    .slice(0, MAX_FRAMES);
  const scriptUrls = [...new Set(frames.map((frame) => frame.url))].slice(
    0,
    MAX_MAPS_PER_STACK,
  );
  if (scriptUrls.length === 0) return { stack, resolvedFrames: 0 };

  const fetchMap =
    options.fetchMap ?? ((url: string) => loadMap(url, options.fetchImpl));
  const maps = new Map(
    await Promise.all(
      scriptUrls.map(async (url) => {
        try {
          return [url, await fetchMap(url)] as const;
        } catch {
          return [url, null] as const;
        }
      }),
    ),
  );
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  let resolvedFrames = 0;
  for (const frame of frames) {
    const map = maps.get(frame.url);
    if (!map) continue;
    let original: ReturnType<typeof originalPositionFor>;
    try {
      original = originalPositionFor(map, {
        line: frame.line,
        column: Math.max(0, frame.column - 1),
      });
    } catch {
      continue;
    }
    if (
      typeof original.source !== "string" ||
      typeof original.line !== "number" ||
      typeof original.column !== "number"
    ) {
      continue;
    }
    resolvedFrames += 1;
    replacements.push({
      start: frame.index,
      end: frame.index + frame.match.length,
      value: `${normalizeSourcePath(original.source)
        .replace(/[\u0000-\u001f\u007f()[\]{}]/g, "_")
        .slice(0, 512)}:${original.line}:${original.column + 1}`,
    });
  }

  let resolvedStack = stack;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    resolvedStack =
      resolvedStack.slice(0, replacement.start) +
      replacement.value +
      resolvedStack.slice(replacement.end);
  }
  return resolvedFrames
    ? { stack: resolvedStack, resolvedFrames }
    : { stack, resolvedFrames: 0 };
}
