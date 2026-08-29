import { parse } from "node-html-parser";
import { escapeHtml } from "./escapeHtml";

const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "iframe",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "object",
  "embed",
  "svg",
  "math",
]);

const VOID_TAGS = new Set(["br", "hr", "img"]);

const GLOBAL_ATTRIBUTES = new Set(["class"]);

const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel", "title"]),
  // HTML-block (Pages canvas): the raw HTML lives base64-encoded in data-html,
  // never as live child nodes, so it is only ever executed in the sandboxed
  // iframe NodeView. Base64 has no <>"'& chars, so it round-trips escapeHtml.
  div: new Set(["data-html-block", "data-html"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
  iframe: new Set(["src", "width", "height", "allowfullscreen", "title"]),
  li: new Set(["data-checked", "data-type"]),
  ol: new Set(["start"]),
  span: new Set([
    "contenteditable",
    "data-id",
    "data-label",
    "data-type",
    "projectid",
    "text",
    "uniqueindex",
  ]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
  ul: new Set(["data-type"]),
};

const ALLOWED_IFRAME_SOURCES = [
  { hostname: "www.loom.com", pathnamePrefix: "/embed/" },
  { hostname: "www.youtube.com", pathnamePrefix: "/embed/" },
  { hostname: "www.youtube-nocookie.com", pathnamePrefix: "/embed/" },
  { hostname: "player.vimeo.com", pathnamePrefix: "/video/" },
  { hostname: "www.figma.com", pathnamePrefix: "/embed" },
] as const;

function isAllowedAttribute(tag: string, name: string) {
  if (tag === "iframe") {
    return TAG_ATTRIBUTES.iframe.has(name);
  }

  return GLOBAL_ATTRIBUTES.has(name) || TAG_ATTRIBUTES[tag]?.has(name);
}

function isAllowedIframeUrl(value: string) {
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

function getAttributeValue(attributes: Record<string, string>, name: string) {
  const attribute = Object.entries(attributes).find(
    ([rawName]) => rawName.toLowerCase() === name,
  );
  return String(attribute?.[1] ?? "");
}

function isSafeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return true;

  try {
    const url = new URL(trimmed, "https://app.hypertask.ai");
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isSafeIntegerAttribute(value: string) {
  return /^\d{1,3}$/.test(value.trim());
}

function isSafeDataAttributeValue(tag: string, name: string, value: string) {
  if (tag === "ul" && name === "data-type") {
    return value === "taskList";
  }

  if (tag === "li" && name === "data-type") {
    return value === "taskItem";
  }

  if (tag === "li" && name === "data-checked") {
    return value === "true" || value === "false";
  }

  return true;
}

function sanitizeAttributes(tag: string, attributes: Record<string, string>) {
  const safeAttributes: string[] = [];

  for (const [rawName, rawValue] of Object.entries(attributes)) {
    const name = rawName.toLowerCase();
    const value = String(rawValue ?? "");

    if (name.startsWith("on") || name === "style" || !isAllowedAttribute(tag, name)) {
      continue;
    }

    if (tag === "iframe" && name === "src" && !isAllowedIframeUrl(value)) {
      continue;
    }

    if ((name === "href" || name === "src") && !isSafeUrl(value)) {
      continue;
    }

    if ((name === "width" || name === "height" || name === "colspan" || name === "rowspan" || name === "start") && !isSafeIntegerAttribute(value)) {
      continue;
    }

    if (name.startsWith("data-") && !isSafeDataAttributeValue(tag, name, value)) {
      continue;
    }

    if (name === "target" && value !== "_blank") {
      continue;
    }

    const normalizedValue =
      tag === "a" && name === "rel" && attributes.target === "_blank"
        ? "noopener noreferrer nofollow"
        : value;

    safeAttributes.push(`${name}="${escapeHtml(normalizedValue)}"`);
  }

  if (tag === "a" && attributes.target === "_blank" && !attributes.rel) {
    safeAttributes.push('rel="noopener noreferrer nofollow"');
  }

  return safeAttributes.length > 0 ? ` ${safeAttributes.join(" ")}` : "";
}

function renderNode(node: any, preSentinel: string): string {
  if (node.nodeType === 3) {
    return escapeHtml(node.text ?? "");
  }

  if (node.nodeType !== 1) {
    return "";
  }

  const parsedTag = String(node.rawTagName ?? "").toLowerCase();
  const tag = parsedTag === preSentinel ? "pre" : parsedTag;
  const nodeAttributes = node.attributes ?? {};
  if (tag === "iframe" && !isAllowedIframeUrl(getAttributeValue(nodeAttributes, "src"))) {
    return "";
  }

  if (DROP_WITH_CONTENT.has(tag)) {
    return "";
  }

  const children = (node.childNodes ?? [])
    .map((child: any) => renderNode(child, preSentinel))
    .join("");
  if (parsedTag !== preSentinel && !ALLOWED_TAGS.has(tag)) {
    return children;
  }

  const attributes = sanitizeAttributes(tag, nodeAttributes);
  if (VOID_TAGS.has(tag)) {
    return `<${tag}${attributes}>`;
  }

  return `<${tag}${attributes}>${children}</${tag}>`;
}

function replacePreTagNames(value: string, preSentinel: string) {
  let result = "";
  let cursor = 0;

  while (cursor < value.length) {
    const tagStart = value.indexOf("<", cursor);
    if (tagStart === -1) {
      result += value.slice(cursor);
      break;
    }

    result += value.slice(cursor, tagStart);

    const nextCharacter = value[tagStart + 1] ?? "";
    if (!/[A-Za-z!/?]/.test(nextCharacter)) {
      result += "<";
      cursor = tagStart + 1;
      continue;
    }

    let quote = "";
    let tagEnd = tagStart + 1;
    for (; tagEnd < value.length; tagEnd += 1) {
      const character = value[tagEnd];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
    }

    if (tagEnd >= value.length) {
      result += value.slice(tagStart);
      break;
    }

    result += value
      .slice(tagStart, tagEnd + 1)
      .replace(/^<(\/?)pre(?=[\s/>])/i, `<$1${preSentinel}`);
    cursor = tagEnd + 1;
  }

  return result;
}

export function sanitizeRichHtml(value: string) {
  // node-html-parser treats <pre> content as raw text and never parses
  // inner HTML tags (e.g. <code>, <span>). Choose an internal tag that does
  // not occur in this input, then map only that parsed tag back to <pre>.
  // This avoids globally rewriting user-supplied lookalike tags.
  const lowerValue = value.toLowerCase();
  let preSentinel = "x-ht-pre";
  while (
    lowerValue.includes(`<${preSentinel}`) ||
    lowerValue.includes(`</${preSentinel}`)
  ) {
    preSentinel += "-x";
  }

  const patched = replacePreTagNames(value, preSentinel);

  const root = parse(patched, {
    comment: false,
    lowerCaseTagName: true,
  });

  return root.childNodes
    .map((node) => renderNode(node, preSentinel))
    .join("");
}
