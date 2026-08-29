/**
 * Server-side @mention resolution for CLI/MCP comments (HTPR-3783).
 *
 * Turns plain "@Display Name" or "@<id>" tokens into the mention spans the
 * notification pipeline (extractTipTapContent) already understands, so callers
 * — especially the CLI and Claude Code sessions — never have to hand-write the
 * markup. The string transform is pure + synchronous so it stays unit-checkable
 * (see resolveMentions.check.ts).
 */

export interface ResolvableMember {
  /** number = human user (label name-<id>); string = board agent (label agent-<id>) */
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
  // SECURITY: Keep staging's HTML escaping and the PR's label-attribute escaping for server-side mention injection.
  const escapedDisplayName = escapeHtml(member.displayName);
  const escapedLabel = escapeHtml(label);
  // Mirrors taskDetailConfig.urls.templates.mention. Inlined (not imported) so
  // this module has no "@/" alias imports and the .check.ts file runs under
  // `node --experimental-strip-types`. data-type + data-label are the only
  // load-bearing attributes; the rest match what the editor emits.
  return `<span data-type="mention" class="mention" data-id="${escapedDisplayName}" data-label="${escapedLabel}" uniqueindex="" projectid="">${escapedDisplayName}</span>`;
}

/**
 * Replaces "@Display Name" and "@<id>" tokens in `text` with mention spans for
 * the given members.
 *
 * - `(?<!\w)` before `@` skips email addresses (foo@bar) and mid-word "@".
 * - Longest display name first, so "@John Doe" wins over "@John".
 * - Pass 1: exact id or exact (full) display name, case-insensitive.
 * - Pass 2: a leftover single-word "@Token" resolves when it is a prefix of
 *   exactly ONE member's display name (the "@Abdul" -> "Abdul Wahhab" case).
 *   Ambiguous (>1 match) or zero matches are left as plain text — never guess.
 */
export function injectMentionSpans(
  text: string,
  members: ResolvableMember[],
): string {
  if (!text || !members?.length) return text;
  // Longest display name first so a shorter name can't eat part of a longer one.
  const sorted = [...members].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  );
  let result = text;

  // Pass 1: exact id and exact full display name.
  for (const m of sorted) {
    const span = spanFor(m);
    // @<id> (exact)
    result = result.replace(
      new RegExp(`(?<!\\w)@${escapeRegExp(String(m.id))}\\b`, "g"),
      span,
    );
    // @Display Name (case-insensitive)
    if (m.displayName) {
      result = result.replace(
        new RegExp(`(?<!\\w)@${escapeRegExp(m.displayName)}\\b`, "gi"),
        span,
      );
    }
  }

  // Pass 2: unique-prefix (first-name) resolution for any "@Token" still left
  // as plain text. Only fires when exactly one member's display name starts
  // with the token, so ambiguity never produces a wrong mention.
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
