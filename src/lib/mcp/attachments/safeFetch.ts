import dns from 'node:dns/promises';
import net, { type LookupFunction } from 'node:net';
import { Agent } from 'undici';
import {
  MCP_ATTACHMENT_FETCH_TIMEOUT_MS,
  MCP_ATTACHMENT_MAX_BYTES,
  MCP_ATTACHMENT_MAX_REDIRECTS,
  isAllowedMime,
  normalizeMime,
} from './constants';

function parseHostAllowlist(): Set<string> {
  const raw = process.env.MCP_ATTACHMENT_FETCH_HOST_ALLOWLIST?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
  );
}

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

/** True if IPv4 is RFC1918, loopback, link-local, CGNAT, or reserved. */
function isPrivateOrReservedIPv4(ip: string): boolean {
  const n = ipv4ToNumber(ip);
  if (n === null) return true;
  const a = (n >>> 24) & 0xff;
  const b = (n >>> 16) & 0xff;
  const c = (n >>> 8) & 0xff;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function parseIPv6Segments(ip: string): number[] | null {
  let normalized = ip.toLowerCase();
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    const ipv4 = ipv4ToNumber(normalized.slice(lastColon + 1));
    if (lastColon < 0 || ipv4 === null) return null;
    normalized = `${normalized.slice(0, lastColon)}:${(
      ipv4 >>> 16
    ).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const omitted = 8 - head.length - tail.length;
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) {
    return null;
  }

  const raw = [...head, ...Array(omitted).fill('0'), ...tail];
  if (raw.length !== 8 || raw.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }
  return raw.map((part) => Number.parseInt(part, 16));
}

function mappedIPv4Address(ip: string): string | null {
  const segments = parseIPv6Segments(ip);
  if (
    !segments ||
    segments.slice(0, 5).some((segment) => segment !== 0) ||
    segments[5] !== 0xffff
  ) {
    return null;
  }
  return [
    segments[6] >>> 8,
    segments[6] & 0xff,
    segments[7] >>> 8,
    segments[7] & 0xff,
  ].join('.');
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const x = ip.toLowerCase();
  const mapped = mappedIPv4Address(x);
  if (mapped) return isPrivateOrReservedIPv4(mapped);
  const segments = parseIPv6Segments(x);
  if (!segments) return true;

  // Only global-unicast 2000::/3 is eligible. This rejects unspecified,
  // loopback, link-local, ULA, site-local, multicast, and transition ranges.
  if ((segments[0] & 0xe000) !== 0x2000) return true;
  // Documentation, benchmarking, ORCHID, Teredo, and 6to4 are not origins.
  if (segments[0] === 0x2002) return true;
  if (
    segments[0] === 0x2001 &&
    (segments[1] === 0 ||
      segments[1] === 2 ||
      segments[1] === 0xdb8 ||
      (segments[1] >= 0x10 && segments[1] <= 0x2f))
  ) {
    return true;
  }
  return false;
}

function isPrivateOrReservedAddress(addr: string, family: 4 | 6): boolean {
  if (family === 4) return isPrivateOrReservedIPv4(addr);
  return isPrivateOrReservedIPv6(addr);
}

function abortError(): Error {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

async function resolvePublicAddress(
  hostname: string,
  signal: AbortSignal
): Promise<PinnedAddress> {
  const normalizedHostname =
    hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
  const allow = parseHostAllowlist();
  const h = normalizedHostname.toLowerCase();
  if (allow.size > 0 && !allow.has(h)) {
    throw new McpAttachmentFetchError(`Host is not in MCP_ATTACHMENT_FETCH_HOST_ALLOWLIST: ${normalizedHostname}`);
  }

  const ipVersion = net.isIP(normalizedHostname);
  if (ipVersion === 4) {
    if (isPrivateOrReservedIPv4(normalizedHostname)) {
      throw new McpAttachmentFetchError('URL resolves to a disallowed (private/reserved) address');
    }
    return { address: normalizedHostname, family: 4 };
  }
  if (ipVersion === 6) {
    const mapped = mappedIPv4Address(normalizedHostname);
    if (mapped) {
      if (isPrivateOrReservedIPv4(mapped)) {
        throw new McpAttachmentFetchError('URL resolves to a disallowed (private/reserved) address');
      }
      return { address: mapped, family: 4 };
    }
    if (isPrivateOrReservedIPv6(normalizedHostname)) {
      throw new McpAttachmentFetchError('URL resolves to a disallowed (private/reserved) address');
    }
    return { address: normalizedHostname, family: 6 };
  }

  const records = await abortable(
    dns.lookup(normalizedHostname, { all: true }),
    signal
  );
  if (!records.length) {
    throw new McpAttachmentFetchError('Could not resolve URL host');
  }
  for (const r of records) {
    const fam = r.family === 6 ? 6 : 4;
    if (isPrivateOrReservedAddress(r.address, fam)) {
      throw new McpAttachmentFetchError('URL resolves to a disallowed (private/reserved) address');
    }
  }
  const selected = records[0];
  return {
    address: selected.address,
    family: selected.family === 6 ? 6 : 4,
  };
}

export class McpAttachmentFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpAttachmentFetchError';
  }
}

export async function readBodyWithCap(
  res: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<Buffer> {
  const body = res.body;
  if (!body) {
    throw new McpAttachmentFetchError('Empty response body');
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let completed = false;
  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      if (value && value.length) {
        total += value.length;
        if (total > maxBytes) {
          throw new McpAttachmentFetchError(`Download exceeds maximum size (${maxBytes} bytes)`);
        }
        chunks.push(Buffer.from(value));
      }
    }
    completed = true;
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function assertHttpUrlString(urlString: string): URL {
  let u: URL;
  try {
    u = new URL(urlString);
  } catch {
    throw new McpAttachmentFetchError('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new McpAttachmentFetchError('Only http and https URLs are allowed');
  }
  if (u.username || u.password) {
    throw new McpAttachmentFetchError('URL must not include credentials');
  }
  return u;
}

/**
 * Fetch remote bytes with SSRF protections, size cap, and redirect limit.
 */
export async function safeFetchAttachmentUrl(
  urlString: string,
  externalSignal?: AbortSignal
): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  let current = urlString.trim();
  let hops = 0;
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(),
    MCP_ATTACHMENT_FETCH_TIMEOUT_MS
  );

  try {
    while (hops <= MCP_ATTACHMENT_MAX_REDIRECTS) {
      const u = assertHttpUrlString(current);
      const pinned = await resolvePublicAddress(u.hostname, controller.signal);
      const lookup: LookupFunction = (_hostname, options, callback) => {
        if (options.all) {
          callback(null, [pinned]);
        } else {
          callback(null, pinned.address, pinned.family);
        }
      };
      const dispatcher = new Agent({ connect: { lookup } });
      try {
        const res = await fetch(u.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          dispatcher,
          headers: {
            Accept: '*/*',
            'User-Agent': 'Hypertasks-MCP-AttachmentFetch/1.0',
          },
        } as RequestInit & { dispatcher: Agent });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          await res.body?.cancel();
          if (!loc) {
            throw new McpAttachmentFetchError('Redirect without Location header');
          }
          hops += 1;
          if (hops > MCP_ATTACHMENT_MAX_REDIRECTS) {
            throw new McpAttachmentFetchError('Too many redirects');
          }
          current = new URL(loc, u).toString();
          continue;
        }

        if (!res.ok) {
          await res.body?.cancel();
          throw new McpAttachmentFetchError(`HTTP ${res.status} when fetching URL`);
        }

        const ctHeader = res.headers.get('content-type');
        if (!ctHeader) {
          await res.body?.cancel();
          throw new McpAttachmentFetchError('Response missing Content-Type');
        }
        const contentType = normalizeMime(ctHeader);
        if (!isAllowedMime(contentType)) {
          await res.body?.cancel();
          throw new McpAttachmentFetchError(`Unsupported Content-Type from URL: ${contentType}`);
        }

        const buffer = await readBodyWithCap(
          res,
          MCP_ATTACHMENT_MAX_BYTES,
          controller.signal
        );
        return { buffer, contentType };
      } finally {
        await dispatcher.close();
      }
    }

    throw new McpAttachmentFetchError('Too many redirects');
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new McpAttachmentFetchError('Fetch timed out');
    }
    if (e instanceof McpAttachmentFetchError) throw e;
    throw new McpAttachmentFetchError((e as Error).message || 'Fetch failed');
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
}
