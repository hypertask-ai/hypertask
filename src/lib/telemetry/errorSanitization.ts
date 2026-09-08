const HEADER_SECRET =
  /\b(authorization|proxy-authorization|cookie|set-cookie)(\s*[:=]\s*)[^\r\n]+/gi;
const SERIALIZED_HEADER_SECRET =
  /((?:\\+)?(["'])(?:authorization|proxy-authorization|cookie|set-cookie)(?:\\+)?\2\s*[:=]\s*)[^\r\n]+/gi;
const AUTH_SCHEME_SECRET = /\b(Bearer|Basic)(\s+)["']?[^\s"']+["']?/gi;
// A PEM private key spans lines; every line after the header has no key
// marker, so a line-anchored value pattern would leak it (delegated review
// on HTPR-6238). An unterminated header still eats the rest of the text.
const PEM_PRIVATE_KEY =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;
const SERIALIZED_NAMED_SECRET =
  /((["'])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|secret|session|token)\2\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\r\n]+)/gi;
const ESCAPED_NAMED_SECRET =
  /((?:\\+["'])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|secret|session|token)(?:\\+["'])\s*[:=]\s*)[^\r\n]+/gi;
// ponytail: quoted values may span lines so a multiline JSON/YAML secret is
// fully consumed; the cost is that an unterminated quote over-redacts the
// rest of the text. Unquoted multiline values (no key marker per line) are
// not covered — add a format-specific pattern if one shows up in practice.
const QUOTED_NAMED_SECRET =
  /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|secret|session|token)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?)/gi;
const UNQUOTED_NAMED_SECRET =
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|secret|session|token)(\s*[:=]\s*)[^\r\n]+/gi;
const URI_USERINFO_SECRET =
  /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/]+@/gi;
const WEB_URL = /\bhttps?:\/\/[^\s<>"']+/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const OPAQUE_PATH_SEGMENT =
  /^(?:[A-Za-z0-9_.=-]{24,}|[0-9a-f]{8}-[0-9a-f-]{27,35})$/i;

const ALLOWED_EXTRA_KEYS = new Set([
  "digest",
  "errorMessage",
  "errorName",
  "method",
  "origin",
  "prismaBatchRequestIndex",
  "prismaClientVersion",
  "prismaCode",
  "route",
  "router",
  "stage",
]);

type Extra = Record<string, string | number | boolean | null>;

// Path segments can carry secrets on their own (reset tokens, signed URLs), so both the
// dedicated URL field (safeErrorUrl) and any URL spotted inside free text (redactErrorText)
// redact them the same way instead of passing the pathname through untouched.
function sanitizePathname(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      let decoded: string;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return "[redacted]";
      }
      if (OPAQUE_PATH_SEGMENT.test(decoded)) return "[redacted]";
      return encodeURIComponent(redactErrorText(decoded, 160));
    })
    .join("/");
}

export function redactErrorText(value: string, limit: number) {
  return value
    .replace(PEM_PRIVATE_KEY, "[redacted]")
    .replace(WEB_URL, (match) => {
      try {
        const parsed = new URL(match);
        return `${parsed.origin}${sanitizePathname(parsed.pathname)}`;
      } catch {
        return "[redacted]";
      }
    })
    .replace(SERIALIZED_HEADER_SECRET, '$1"[redacted]"')
    .replace(HEADER_SECRET, "$1$2[redacted]")
    .replace(AUTH_SCHEME_SECRET, "$1$2[redacted]")
    .replace(SERIALIZED_NAMED_SECRET, '$1"[redacted]"')
    .replace(ESCAPED_NAMED_SECRET, '$1\\"[redacted]\\"')
    .replace(QUOTED_NAMED_SECRET, "$1\"[redacted]\"")
    .replace(UNQUOTED_NAMED_SECRET, "$1$2[redacted]")
    .replace(URI_USERINFO_SECRET, "$1[redacted]@")
    .replace(EMAIL, "[redacted]")
    .slice(0, limit);
}

export function safeErrorUrl(value?: string) {
  if (!value) return undefined;
  try {
    const trustedOrigins = [
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
      process.env.BETTER_AUTH_URL,
    ]
      .filter((origin): origin is string => Boolean(origin))
      .map((origin) => new URL(origin).origin);
    if (trustedOrigins.length === 0) return undefined;
    const parsed = new URL(value, trustedOrigins[0]);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    if (!trustedOrigins.includes(parsed.origin)) return undefined;
    return `${parsed.origin}${sanitizePathname(parsed.pathname)}`.slice(0, 2048);
  } catch {
    return undefined;
  }
}

export function safeErrorExtra(extra?: Extra) {
  if (!extra) return {};
  return Object.fromEntries(
    Object.entries(extra)
      .filter(([key]) => ALLOWED_EXTRA_KEYS.has(key))
      .slice(0, 12)
      .map(([key, value]) => [
        `ht_${key}`,
        typeof value === "string" ? redactErrorText(value, 1000) : value,
      ]),
  );
}
