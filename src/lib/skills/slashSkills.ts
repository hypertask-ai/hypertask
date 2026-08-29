import { Sparkles } from "lucide-react";
import type { Editor } from "@tiptap/react";

// Skills shown in the "/" menu: the current board's skills plus the user's
// personal skills, resolved server-side from a "/slug" token in the message
// (AI chat) or an "@hyperai /slug" comment. See src/app/api/ai/_lib/skills.ts.
export type SlashSkill = {
  slug: string;
  name: string;
  description: string | null;
  isProject: boolean;
};

// Marks the open "/" command popup in the DOM so send-on-Enter handlers can
// reliably tell the menu is open (defaultPrevented is unreliable on iOS).
export const SLASH_MENU_DOM_ID = "ht-slash-command-menu";

export type SkillSlashItem = {
  title: string;
  text: string;
  type: "SKILL";
  aliases: string[];
  icon: typeof Sparkles;
  command: (args: { editor: Editor; range: any }) => void;
};

// A personal and a project skill can share a slug. The server resolver always
// picks the project one, so collapse duplicates to a single entry (project
// wins) instead of rendering a dead personal duplicate.
export function dedupeSkillsBySlug(skills: SlashSkill[]): SlashSkill[] {
  const bySlug = new Map<string, SlashSkill>();
  for (const skill of skills) {
    const existing = bySlug.get(skill.slug);
    if (!existing || (skill.isProject && !existing.isProject)) {
      bySlug.set(skill.slug, skill);
    }
  }
  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// The server resolver only matches "/slug" at line start or after whitespace or
// "(". A mid-text trigger ("foo/rev") would insert an unresolvable token, so
// return a leading space when the char before the "/" isn't one of those.
export function slashTokenPrefix(charBefore: string): string {
  return charBefore.length > 0 && !/[\s(]/.test(charBefore) ? " " : "";
}

// The "/" menu re-queries on every keystroke; a short cache keeps that from
// hammering /api/ai/skills while the user types. Keyed by board (or "personal").
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; skills: SlashSkill[] }>();
const inflight = new Map<string, Promise<SlashSkill[]>>();

export async function fetchSlashSkills(
  projectId?: number | null
): Promise<SlashSkill[]> {
  const key = projectId ? String(projectId) : "personal";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.skills;

  const existing = inflight.get(key);
  if (existing) return existing;

  const request = (async () => {
    try {
      const url = projectId
        ? `/api/ai/skills?projectId=${projectId}`
        : "/api/ai/skills";
      const res = await fetch(url);
      if (!res.ok) return hit?.skills ?? [];
      const data = await res.json();
      const mapped: SlashSkill[] = (data.skills ?? [])
        .filter((s: any) => s?.enabled && s?.slug)
        .map((s: any) => ({
          slug: String(s.slug),
          name: String(s.name ?? s.slug),
          description: s.description ?? null,
          isProject: s.projectId != null,
        }));
      const skills = dedupeSkillsBySlug(mapped);
      cache.set(key, { at: Date.now(), skills });
      return skills;
    } catch {
      return hit?.skills ?? [];
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, request);
  return request;
}

// Selecting a skill drops "/slug " where the "/" was typed. The server resolver
// strips the token and injects the skill body, so plain text is all we insert.
export function buildSkillSlashItems(skills: SlashSkill[]): SkillSlashItem[] {
  return skills.map((skill) => ({
    title: `/${skill.slug}`,
    text: skill.description || skill.name,
    type: "SKILL",
    aliases: [skill.slug, skill.name],
    icon: Sparkles,
    command: ({ editor, range }) => {
      // "/" triggers mid-text (allowedPrefixes: null), so range.from can sit
      // right after a word char, e.g. "foo/rev". The server resolver only
      // matches "/slug" at line start or after whitespace/"(", so prepend a
      // space when the preceding char isn't one of those, otherwise the token
      // silently fails to resolve.
      const before =
        range.from > 0
          ? editor.state.doc.textBetween(range.from - 1, range.from, "\n", "\n")
          : "";
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent(`${slashTokenPrefix(before)}/${skill.slug} `)
        .run();
    },
  }));
}
