const SCREENCAST2_HOSTS = new Set(["screencast2.com", "www.screencast2.com"]);
const IMAGE_PATH = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const IMAGE_SRC_RE = /(<img\b[^>]*?\ssrc\s*=\s*)(["'])([^"']*)\2/gi;

/**
 * Screencast2's share URL looks like an image URL but serves an HTML viewer.
 * Adding the provider's `raw` query flag returns the image payload itself.
 */
export const normalizeImageSource = (src: string): string => {
  if (!src) return src;

  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return src;
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !SCREENCAST2_HOSTS.has(parsed.hostname.toLowerCase()) ||
    !IMAGE_PATH.test(parsed.pathname) ||
    parsed.searchParams.has("raw")
  ) {
    return src;
  }

  const fragmentIndex = src.indexOf("#");
  const base = fragmentIndex === -1 ? src : src.slice(0, fragmentIndex);
  const fragment = fragmentIndex === -1 ? "" : src.slice(fragmentIndex);
  const separator = parsed.search ? "&" : "?";

  return `${base}${separator}raw${fragment}`;
};

export const normalizeImageSourcesInHtml = (html: string): string =>
  html.replace(
    IMAGE_SRC_RE,
    (_match, prefix: string, quote: string, src: string) =>
      `${prefix}${quote}${normalizeImageSource(src)}${quote}`,
  );
