import { Sparkles } from "lucide-react";
import type { Editor } from "@tiptap/react";

export type SlashSkill = {
  slug: string;
  name: string;
  description: string | null;
  isProject: boolean;
};

export const SLASH_MENU_DOM_ID = "ht-slash-command-menu";

export type SkillSlashItem = {
  title: string;
  text: string;
  type: "SKILL";
  aliases: string[];
  icon: typeof Sparkles;
  command: (args: { editor: Editor; range: any }) => void;
};

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

export function slashTokenPrefix(charBefore: string): string {
  return charBefore.length > 0 && !/[\s(]/.test(charBefore) ? " " : "";
}

const CACHE_TTL_MS = 60_000;
let generation = 0;
const cache = new Map<string, { at: number; skills: SlashSkill[] }>();
const inflight = new Map<string, Promise<SlashSkill[]>>();

export function invalidateSlashSkills() {
  generation++;
  cache.clear();
  inflight.clear();
}

export async function fetchSlashSkills(
  projectId?: number | null
): Promise<SlashSkill[]> {
  const key = projectId ? String(projectId) : "personal";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.skills;

  const existing = inflight.get(key);
  if (existing) return existing;

  const requestGeneration = generation;
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
      if (requestGeneration === generation) cache.set(key, { at: Date.now(), skills });
      return skills;
    } catch {
      return hit?.skills ?? [];
    } finally {
      if (requestGeneration === generation) inflight.delete(key);
    }
  })();

  inflight.set(key, request);
  return request;
}

export function buildSkillSlashItems(skills: SlashSkill[]): SkillSlashItem[] {
  return skills.map((skill) => ({
    title: `/${skill.slug}`,
    text: skill.description || skill.name,
    type: "SKILL",
    aliases: [skill.slug, skill.name],
    icon: Sparkles,
    command: ({ editor, range }) => {
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
