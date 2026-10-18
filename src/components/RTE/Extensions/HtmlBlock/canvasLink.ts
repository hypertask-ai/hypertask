export function resolveCanvasLink(
  href: unknown,
  appOrigin: string,
): { kind: "internal"; path: string; url: string } | { kind: "external"; url: string } | null {
  if (typeof href !== "string") return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const routableInApp = url.origin === appOrigin && !url.pathname.startsWith("//");
    return routableInApp
      ? { kind: "internal", path: url.pathname + url.search + url.hash, url: url.href }
      : { kind: "external", url: url.href };
  } catch {
    return null;
  }
}
