"use client";

import { useFlag } from "@/hooks/useFlag";
import { AGENT_CHAT_SKILLS_FLAG } from "@/lib/flags/keys";

import SettingsSectionShell from "./SettingsSectionShell";
import SkillLibrary from "./SkillLibrary";
import { useSettingsTeam } from "./useSettingsTeam";

export default function BoardSkillsSection() {
  const { project } = useSettingsTeam();
  const agentChatSkillsEnabled = useFlag(AGENT_CHAT_SKILLS_FLAG);
  if (!project) return null;

  return (
    <SettingsSectionShell title="Skills">
      <p className="text-dense font-medium text-text-light-gray">
        {agentChatSkillsEnabled
          ? "Type /slug in AI chat, or @hyperai /slug in a comment."
          : "Type @hyperai /slug in a comment."}
      </p>
      <SkillLibrary scope="project" projectId={project.id} />
    </SettingsSectionShell>
  );
}
