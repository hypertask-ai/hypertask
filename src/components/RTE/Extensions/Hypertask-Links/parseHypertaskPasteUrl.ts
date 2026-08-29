export interface HypertaskUrlMatch {
  type: "share" | "detail";
  id: string;
  projectId?: string;
  fullUrl: string;
}

const isSupportedHost = (url: URL) =>
  url.hostname === "app.hypertask.ai" || url.hostname === "localhost";

export const createShareLookupUrl = (shareId: string) => {
  const query = new URLSearchParams({ shareId });
  return `/api/share/createShareLink?${query.toString()}`;
};

/**
 * Parse a clipboard value only when the entire value is one Hypertask URL.
 * Surrounding whitespace is harmless, but prose or multiple lines must remain
 * available to Tiptap's normal paste pipeline.
 */
export const parseHypertaskPasteUrl = (
  clipboardText: string,
): HypertaskUrlMatch | null => {
  const fullUrl = clipboardText.trim();
  if (!fullUrl || /[\u0000-\u0020\u007f]/.test(fullUrl)) return null;

  let url: URL;
  try {
    url = new URL(fullUrl);
  } catch {
    return null;
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !isSupportedHost(url)
  ) {
    return null;
  }

  if (url.pathname === "/share") {
    const shareId = url.searchParams.get("id");
    return shareId
      ? { type: "share", id: shareId, fullUrl }
      : null;
  }

  const detailMatch = url.pathname.match(
    /^\/detail\/project-(\d+)\/(\d+)\/?$/,
  );
  if (!detailMatch) return null;

  return {
    type: "detail",
    id: detailMatch[1],
    projectId: detailMatch[2],
    fullUrl,
  };
};
