
export interface ResolvableMember {
  id: number | string;
  displayName: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });

const MENTION_SPAN =
  /<span\b[^>]*\bdata-type=["']mention["'][^>]*>[\s\S]*?<\/span>/gi;
const SPAN_CLOSE = "</span>";

function labelFor(member: ResolvableMember): string {
  return typeof member.id === "number"
    ? `name-${member.id}`
    : `agent-${member.id}`;
}

function spanFor(member: ResolvableMember): string {
  const escapedDisplayName = escapeHtml(member.displayName);
  const escapedLabel = escapeHtml(labelFor(member));
  return `<span data-type="mention" class="mention" data-id="${escapedDisplayName}" data-label="${escapedLabel}" uniqueindex="" projectid="">${escapedDisplayName}</span>`;
}

function attributePattern(name: string): RegExp {
  return new RegExp(`(\\b${name}=)(["'])([\\s\\S]*?)\\2`, "i");
}

function readAttribute(tag: string, name: string): string | undefined {
  const match = attributePattern(name).exec(tag);
  return match ? match[3] : undefined;
}

function writeAttribute(tag: string, name: string, value: string): string {
  const pattern = attributePattern(name);
  if (pattern.test(tag)) {
    return tag.replace(pattern, (_whole, prefix, quote) => `${prefix}${quote}${value}${quote}`);
  }
  return tag.replace(/>$/, ` ${name}="${value}">`);
}

function memberByName(
  name: string,
  members: ResolvableMember[],
): ResolvableMember | undefined {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return undefined;
  const hits = members.filter(
    (member) => member.displayName.trim().toLowerCase() === wanted,
  );
  return hits.length === 1 ? hits[0] : undefined;
}

function memberByLabel(
  label: string,
  members: ResolvableMember[],
): ResolvableMember | undefined {
  const wanted = label.trim();
  if (!wanted) return undefined;
  return members.find((member) => labelFor(member) === wanted);
}

function memberFor(
  name: string,
  label: string,
  members: ResolvableMember[],
): ResolvableMember | undefined {
  return memberByLabel(label, members) ?? memberByName(name, members);
}

function mapOutsideMentionSpans(
  html: string,
  transform: (segment: string) => string,
): string {
  let result = "";
  let cursor = 0;
  for (const match of html.matchAll(MENTION_SPAN)) {
    const start = match.index ?? 0;
    result += transform(html.slice(cursor, start)) + match[0];
    cursor = start + match[0].length;
  }
  return result + transform(html.slice(cursor));
}

export function normalizeMentionSpans(
  html: string,
  members: ResolvableMember[],
): string {
  if (!html || !members?.length) return html;
  if (!/data-type=["']mention["']/i.test(html)) return html;

  return html.replace(MENTION_SPAN, (whole) => {
    const openEnd = whole.indexOf(">") + 1;
    const tag = whole.slice(0, openEnd);
    const member = memberFor(
      readAttribute(tag, "data-id") ?? "",
      readAttribute(tag, "data-label") ?? "",
      members,
    );
    if (!member) return whole;

    const normalizedTag = writeAttribute(
      writeAttribute(tag, "data-id", escapeHtml(member.displayName)),
      "data-label",
      escapeHtml(labelFor(member)),
    );
    return `${normalizedTag}${escapeHtml(member.displayName)}${SPAN_CLOSE}`;
  });
}

export function injectMentionSpans(
  text: string,
  members: ResolvableMember[],
): string {
  if (!text || !members?.length) return text;
  const sorted = [...members].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  );

  const injectInto = (segment: string) => {
    let result = segment;

    for (const m of sorted) {
      const span = spanFor(m);
      result = result.replace(
        new RegExp(`(?<!\\w)@${escapeRegExp(String(m.id))}\\b`, "g"),
        span,
      );
      if (m.displayName) {
        result = result.replace(
          new RegExp(`(?<!\\w)@${escapeRegExp(m.displayName)}\\b`, "gi"),
          span,
        );
      }
    }

    return result.replace(/(?<!\w)@(\p{L}[\p{L}\p{N}'’\-]*)/gu, (whole, token) => {
      const t = token.toLowerCase();
      if (t.length < 2) return whole;
      const hits = sorted.filter(
        (m) => m.displayName && m.displayName.toLowerCase().startsWith(t),
      );
      return hits.length === 1 ? spanFor(hits[0]) : whole;
    });
  };

  return /data-type=["']mention["']/i.test(text)
    ? mapOutsideMentionSpans(text, injectInto)
    : injectInto(text);
}
