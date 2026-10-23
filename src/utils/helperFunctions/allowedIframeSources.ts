export const ALLOWED_IFRAME_SOURCES = [
  { hostname: "www.loom.com", pathnamePrefix: "/embed/" },
  { hostname: "www.youtube.com", pathnamePrefix: "/embed/" },
  { hostname: "www.youtube-nocookie.com", pathnamePrefix: "/embed/" },
  { hostname: "player.vimeo.com", pathnamePrefix: "/video/" },
  { hostname: "www.figma.com", pathnamePrefix: "/embed" },
] as const;

export function isAllowedIframeUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && ALLOWED_IFRAME_SOURCES.some(
      ({ hostname, pathnamePrefix }) =>
        url.hostname === hostname && url.pathname.startsWith(pathnamePrefix),
    );
  } catch {
    return false;
  }
}
