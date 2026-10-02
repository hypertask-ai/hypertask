"use client";

import SettingsSectionShell from "./SettingsSectionShell";
import SkillLibrary from "./SkillLibrary";
import { useSettingsTeam } from "./useSettingsTeam";

export default function BoardSkillsSection() {
  const { project } = useSettingsTeam();
  if (!project) return null;

  return (
    <SettingsSectionShell title="Skills">
      <p className="text-dense font-medium text-text-light-gray">
        Type /slug in AI chat, or @hyperai /slug in a comment.
      </p>
      <SkillLibrary scope="project" projectId={project.id} />
    </SettingsSectionShell>
  );
}
