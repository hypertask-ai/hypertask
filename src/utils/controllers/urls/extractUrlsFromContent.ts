import { parse, HTMLElement } from 'node-html-parser';
import { IUrl } from '@/models/model';
import addIntoTask from '@/utils/controllers/urls/addIntoTask';
import addIntoTaskDesc from '@/utils/controllers/urls/addIntoTaskDesc';

const PLAIN_TEXT_URL_REGEX = /https?:\/\/[^\s<>"']+/g;

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)}\]]+$/, '');
}

function getEmbedTitle(url: string): string {
  let title = 'Embedded Content';

  try {
    const urlObj = new URL(url);

    if (urlObj.hostname.includes('figma.com')) {
      const embedTitle = urlObj.searchParams.get('embed_title');
      title = embedTitle
        ? `Figma Embed: ${decodeURIComponent(embedTitle).replace(/\s+/g, ' ').trim()}`
        : 'Figma Design';
    } else if (urlObj.hostname.includes('loom.com')) {
      const videoId = url.split('/').filter(Boolean).pop()?.split('?')[0];
      title = `Loom Recording: ${videoId}`;
    } else if (urlObj.hostname.includes('youtube.com')) {
      const videoId =
        urlObj.searchParams.get('si')?.split('-')[0] || url.split('/').pop();
      title = `YouTube Video: ${videoId}`;
    }
  } catch {
    // keep default title
  }

  return title;
}

function filenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url, 'http://localhost').pathname;
    const segment = pathname.substring(pathname.lastIndexOf('/') + 1);
    return segment || url;
  } catch {
    return url;
  }
}

/**
 * Deduplicates URL records by urlString (first occurrence wins).
 */
export function mergeUrls(...lists: IUrl[][]): IUrl[] {
  const seen = new Set<string>();
  const merged: IUrl[] = [];

  for (const list of lists) {
    for (const item of list) {
      if (!item.urlString || seen.has(item.urlString)) continue;
      seen.add(item.urlString);
      merged.push(item);
    }
  }

  return merged;
}

/**
 * Converts MCP `images[]` S3 URLs into attachment IUrl records.
 */
export function buildMcpImageUrls(images: string[], taskId: number): IUrl[] {
  return images.map((imageUrl: string) => {
    let fileType = 'image/jpeg';
    let fileName = `image-${Date.now()}.jpg`;

    try {
      const urlPath = new URL(imageUrl).pathname;
      const extension = urlPath.split('.').pop()?.toLowerCase() || 'jpg';

      const mimeTypeMap: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        bmp: 'image/bmp',
      };

      fileType = mimeTypeMap[extension] || 'image/jpeg';
      fileName = `image-${Date.now()}.${extension}`;
    } catch {
      // use defaults
    }

    return {
      urlString: imageUrl,
      TaskId: taskId,
      Attachment: true,
      attachmentType: fileType,
      title: fileName,
    };
  });
}

/**
 * Extracts URLs from comment/description HTML or plain text.
 * Mirrors client-side processHtml URL collection (without mention side effects).
 */
export function extractUrlsFromContent(text: string, taskId: number): IUrl[] {
  const uniqueUrls: IUrl[] = [];
  const urlsArray: string[] = [];

  const addUrlIfUnique = (url: string, title: string) => {
    if (!url || urlsArray.includes(url)) return;
    uniqueUrls.push({
      TaskId: taskId,
      urlString: url,
      title: title.length > 0 ? title : url,
    });
    urlsArray.push(url);
  };

  const html = text || '';
  const root = parse(html, {
    lowerCaseTagName: false,
  });

  root.querySelectorAll('span[data-label^="project"]').forEach((spanElement) => {
    const projectId = spanElement.getAttribute('projectId');
    if (!projectId) return;
    addUrlIfUnique(`/project?id=${projectId}`, spanElement.innerText || spanElement.text);
  });

  root.querySelectorAll('span[data-label="task"]').forEach((spanElement) => {
    const projectId = spanElement.getAttribute('projectId');
    const index = spanElement.getAttribute('uniqueIndex');
    if (!projectId || !index) return;
    addUrlIfUnique(
      `/detail/project-${projectId}/${index}`,
      spanElement.innerText || spanElement.text
    );
  });

  root.querySelectorAll('a').forEach((anchor: HTMLElement) => {
    const url = anchor.getAttribute('href');
    if (url) {
      addUrlIfUnique(url, anchor.innerText || anchor.text);
    }
  });

  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (src) {
      addUrlIfUnique(src, filenameFromUrl(src));
    }
  });

  root.querySelectorAll('iframe').forEach((embed) => {
    const url = embed.getAttribute('src');
    if (url) {
      addUrlIfUnique(url, getEmbedTitle(url));
    }
  });

  const plainMatches = html.match(PLAIN_TEXT_URL_REGEX) ?? [];
  for (const match of plainMatches) {
    addUrlIfUnique(stripTrailingPunctuation(match), stripTrailingPunctuation(match));
  }

  return uniqueUrls;
}

export async function persistUrlsForComment(
  text: string,
  taskId: number,
  commentId: number,
  method: 'POST' | 'PUT',
  extraUrls: IUrl[] = []
): Promise<void> {
  const extracted = extractUrlsFromContent(text, taskId);
  const urlsToAdd = mergeUrls(extracted, extraUrls);

  if (urlsToAdd.length === 0) return;

  await addIntoTask(urlsToAdd, commentId, method);
}

export async function persistUrlsForDescription(
  text: string,
  taskId: number,
  extraUrls: IUrl[] = []
): Promise<void> {
  const extracted = extractUrlsFromContent(text, taskId);
  const urlsToAdd = mergeUrls(extracted, extraUrls);

  if (urlsToAdd.length === 0) return;

  await addIntoTaskDesc(urlsToAdd, taskId, 'PUT');
}
