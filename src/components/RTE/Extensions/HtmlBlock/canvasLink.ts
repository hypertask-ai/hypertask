export function resolveCanvasLink(
  href: unknown,
  appOrigin: string,
): { kind: "internal"; path: string } | { kind: "external"; url: string } | null {
  if (typeof href !== "string") return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin === appOrigin
      ? { kind: "internal", path: url.pathname + url.search + url.hash }
      : { kind: "external", url: url.href };
  } catch {
    return null;
  }
}
