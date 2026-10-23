
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

function spanFor(member: ResolvableMember): string {
  const label =
    typeof member.id === "number" ? `name-${member.id}` : `agent-${member.id}`;
  const escapedDisplayName = escapeHtml(member.displayName);
  const escapedLabel = escapeHtml(label);
  return `<span data-type="mention" class="mention" data-id="${escapedDisplayName}" data-label="${escapedLabel}" uniqueindex="" projectid="">${escapedDisplayName}</span>`;
}

export function injectMentionSpans(
  text: string,
  members: ResolvableMember[],
): string {
  if (!text || !members?.length) return text;
  const sorted = [...members].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  );
  let result = text;

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

  result = result.replace(/(?<!\w)@(\p{L}[\p{L}\p{N}'’\-]*)/gu, (whole, token) => {
    const t = token.toLowerCase();
    if (t.length < 2) return whole;
    const hits = sorted.filter(
      (m) => m.displayName && m.displayName.toLowerCase().startsWith(t),
    );
    return hits.length === 1 ? spanFor(hits[0]) : whole;
  });

  return result;
}
