export function toFilesFallbackUrl(src: string): string | null {
  try {
    const url = new URL(src);
    if (url.protocol !== "https:" || url.host !== "files.hypertask.app") {
      return null;
    }
    return `/files${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}
