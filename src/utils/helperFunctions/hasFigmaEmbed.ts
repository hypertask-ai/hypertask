const IFRAME_SRC_PATTERN = /<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi;

const isFigmaHost = (hostname: string) =>
  hostname === "figma.com" || hostname.endsWith(".figma.com");

export const hasFigmaEmbed = (html: string | null | undefined) => {
  if (!html || !html.toLowerCase().includes("figma")) return false;

  IFRAME_SRC_PATTERN.lastIndex = 0;
  for (const match of html.matchAll(IFRAME_SRC_PATTERN)) {
    try {
      const url = new URL(match[2]);
      if (url.protocol === "https:" && isFigmaHost(url.hostname.toLowerCase())) {
        return true;
      }
    } catch {
    }
  }

  return false;
};
