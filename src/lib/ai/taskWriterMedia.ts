import { isImageUrl } from "@/lib/media/isImageUrl";

const MEDIA_NODE_RE =
  /<div\b(?=[^>]*\bclass\s*=\s*["'][^"']*\b(?:video-wrapper|embed-wrapper)\b[^"']*["'])[^>]*>[\s\S]*?<\/div\s*>|<video\b[^>]*>[\s\S]*?<\/video\s*>|<audio\b[^>]*>[\s\S]*?<\/audio\s*>|<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>|<iframe\b[^>]*\/?>|<embed\b[^>]*\/?>|<img\b[^>]*\/?>/gi;
const MEDIA_TOKEN_RE = /\[\[HT_MEDIA_\d+\]\]/g;

export interface TaskWriterMedia {
  token: string;
  html: string;
}

type TaskWriterMediaTokenFactory = () => string;

export function createTaskWriterMediaTokenFactory(
  ...sources: string[]
): TaskWriterMediaTokenFactory {
  const reservedTokens = new Set(
    sources.flatMap((source) => source.match(MEDIA_TOKEN_RE) ?? [])
  );
  let nextIndex = 1;

  return () => {
    let token = `[[HT_MEDIA_${nextIndex}]]`;
    while (reservedTokens.has(token)) {
      nextIndex += 1;
      token = `[[HT_MEDIA_${nextIndex}]]`;
    }
    reservedTokens.add(token);
    nextIndex += 1;
    return token;
  };
}

function createMediaToken(
  mediaOffsetOrFactory: number | TaskWriterMediaTokenFactory,
  mediaIndex: number
): string {
  return typeof mediaOffsetOrFactory === "function"
    ? mediaOffsetOrFactory()
    : `[[HT_MEDIA_${mediaOffsetOrFactory + mediaIndex + 1}]]`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function extractTaskWriterPromptMedia(
  prompt: string,
  mediaOffsetOrFactory: number | TaskWriterMediaTokenFactory = 0
): { html: string; media: TaskWriterMedia[] } {
  const media: TaskWriterMedia[] = [];
  const html = prompt
    .split("\n")
    .map((line) => {
      const carriageReturn = line.endsWith("\r") ? "\r" : "";
      const content = carriageReturn ? line.slice(0, -1) : line;
      const url = content.trim();
      if (!isImageUrl(url)) return line;

      const token = createMediaToken(mediaOffsetOrFactory, media.length);
      const escapedUrl = escapeHtml(url);
      media.push({
        token,
        html: `<a target="_blank" rel="noopener noreferrer nofollow" href="${escapedUrl}">${escapedUrl}</a><br><img src="${escapedUrl}" media-type="img" width="100%" height="auto" dataalign="left" loading="lazy">`,
      });

      const leadingWhitespace = content.slice(0, content.indexOf(url));
      const trailingWhitespace = content.slice(content.indexOf(url) + url.length);
      return `${leadingWhitespace}${token}${trailingWhitespace}${carriageReturn}`;
    })
    .join("\n");

  return { html, media };
}

export function extractTaskWriterMedia(
  html: string,
  mediaOffsetOrFactory: number | TaskWriterMediaTokenFactory = 0
): {
  html: string;
  media: TaskWriterMedia[];
} {
  const media: TaskWriterMedia[] = [];
  const maskedHtml = html.replace(MEDIA_NODE_RE, (mediaHtml) => {
    const token = createMediaToken(mediaOffsetOrFactory, media.length);
    media.push({ token, html: mediaHtml });
    return token;
  });

  return { html: maskedHtml, media };
}

export function maskTaskWriterMedia(
  html: string,
  media: TaskWriterMedia[]
): string {
  if (media.length === 0) return html;

  const matchingMedia = new Map<string, TaskWriterMedia[]>();
  for (const item of media) {
    const matches = matchingMedia.get(item.html) ?? [];
    matches.push(item);
    matchingMedia.set(item.html, matches);
  }

  const nextMatch = new Map<string, number>();
  return html.replace(MEDIA_NODE_RE, (mediaHtml) => {
    const matches = matchingMedia.get(mediaHtml);
    if (!matches?.length) return mediaHtml;

    const index = nextMatch.get(mediaHtml) ?? 0;
    nextMatch.set(mediaHtml, index + 1);
    return matches[index % matches.length].token;
  });
}

export function restoreTaskWriterMedia(
  html: string,
  media: TaskWriterMedia[],
  appendMissing = true
): string {
  const byToken = new Map(media.map((item) => [item.token, item]));
  const restored = new Set<string>();
  let output = html.replace(MEDIA_TOKEN_RE, (token) => {
    const item = byToken.get(token);
    if (!item) return token;
    if (restored.has(token)) return "";

    restored.add(token);
    return item.html;
  });

  if (appendMissing) {
    output += media
      .filter((item) => !restored.has(item.token))
      .map((item) => item.html)
      .join("");
  }

  return output;
}
