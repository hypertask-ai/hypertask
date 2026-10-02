"use client";

import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";

import SettingsCard from "./SettingsCard";
import SettingsToggle from "./SettingsToggle";

type SkillScope = "user" | "project";
type Skill = {
  id: number;
  projectId: number | null;
  userId: number | null;
  slug: string;
  name: string;
  description: string | null;
  argumentHint: string | null;
  body: string;
  sourceUrl: string | null;
  enabled: boolean;
};
type PreviewSkill = Omit<Skill, "id" | "projectId" | "userId" | "enabled">;

const inputClass =
  "w-full rounded-[5px] border border-border-light-gray-thin bg-modalBackground px-3 py-2 text-dense text-white-black outline-none placeholder:text-text-light-gray focus:border-border-active";
const buttonClass =
  "rounded-[5px] border border-border-light-gray-thin px-3 py-2 text-dense font-semibold text-white-black transition hover:bg-hover-active disabled:cursor-not-allowed disabled:opacity-50";

export default function SkillLibrary({
  scope,
  projectId,
  teamId,
}: {
  scope: SkillScope;
  projectId?: number;
  teamId?: string | null;
}) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [editing, setEditing] = useState<Skill | null>(null);
  const [saving, setSaving] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [preview, setPreview] = useState<PreviewSkill[]>([]);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const params = useMemo(
    () => ({ ...(projectId ? { projectId } : {}), ...(teamId ? { teamId } : {}) }),
    [projectId, teamId]
  );

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get<{ skills: Skill[] }>("/api/ai/skills", {
        params,
      });
      setSkills(
        response.data.skills.filter((skill) =>
          scope === "project" ? skill.projectId === projectId : skill.userId !== null
        )
      );
    } catch (requestError) {
      setError(apiError(requestError));
    } finally {
      setLoading(false);
    }
  }, [params, projectId, scope]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const saveMarkdown = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await axios.patch(`/api/ai/skills/${editing.id}`, { markdown, teamId });
      } else {
        await axios.post("/api/ai/skills", {
          markdown,
          projectId,
          scope,
          teamId,
        });
      }
      setMarkdown("");
      setEditing(null);
      await loadSkills();
    } catch (requestError) {
      setError(apiError(requestError));
    } finally {
      setSaving(false);
    }
  };

  const previewImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const response = await axios.post<{ skills: PreviewSkill[] }>(
        "/api/ai/skills/import",
        { dryRun: true, projectId, scope, teamId, url: importUrl }
      );
      setPreview(response.data.skills);
      setSelectedSlugs(new Set(response.data.skills.map((skill) => skill.slug)));
    } catch (requestError) {
      setError(apiError(requestError));
    } finally {
      setImporting(false);
    }
  };

  const confirmImport = async () => {
    setImporting(true);
    setError(null);
    try {
      await axios.post("/api/ai/skills/import", {
        projectId,
        scope,
        slugs: Array.from(selectedSlugs),
        teamId,
        url: importUrl,
      });
      setImportUrl("");
      setPreview([]);
      setSelectedSlugs(new Set());
      await loadSkills();
    } catch (requestError) {
      setError(apiError(requestError));
    } finally {
      setImporting(false);
    }
  };

  const updateEnabled = async (skill: Skill) => {
    setError(null);
    try {
      await axios.patch(`/api/ai/skills/${skill.id}`, {
        enabled: !skill.enabled,
        teamId,
      });
      setSkills((current) =>
        current.map((item) =>
          item.id === skill.id ? { ...item, enabled: !item.enabled } : item
        )
      );
    } catch (requestError) {
      setError(apiError(requestError));
    }
  };

  const deleteSkill = async (skill: Skill) => {
    if (!window.confirm(`Delete ${skill.name}?`)) return;
    setError(null);
    try {
      await axios.delete(`/api/ai/skills/${skill.id}`, {
        params: teamId ? { teamId } : undefined,
      });
      setSkills((current) => current.filter((item) => item.id !== skill.id));
    } catch (requestError) {
      setError(apiError(requestError));
    }
  };

  return (
    <div className="flex w-full flex-col gap-8">
      {error && <p className="text-dense font-medium text-red-400">{error}</p>}

      <SettingsCard title="Library">
        {loading ? (
          <p className="px-2 py-2 text-text-light-gray">Loading skills</p>
        ) : skills.length === 0 ? (
          <p className="px-2 py-2 text-text-light-gray">No skills yet.</p>
        ) : (
          skills.map((skill) => (
            <div
              className="border-b border-border-light-gray-thin px-2 py-3 last:border-b-0"
              key={skill.id}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-white-black">{skill.name}</p>
                  <p className="text-text-light-gray">/{skill.slug}</p>
                  {skill.description && (
                    <p className="mt-1 text-text-light-gray">{skill.description}</p>
                  )}
                  {skill.sourceUrl && (
                    <a
                      className="mt-1 block truncate text-hypertasks-green hover:underline"
                      href={skill.sourceUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {skill.sourceUrl}
                    </a>
                  )}
                </div>
                <SettingsToggle
                  checked={skill.enabled}
                  inputId={`skill-${skill.id}`}
                  label="Enabled"
                  onChange={() => void updateEnabled(skill)}
                />
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  className={buttonClass}
                  onClick={() => {
                    setEditing(skill);
                    setMarkdown(skillToMarkdown(skill));
                  }}
                  type="button"
                >
                  Edit
                </button>
                <button
                  className={buttonClass}
                  onClick={() => void deleteSkill(skill)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </SettingsCard>

      <SettingsCard title="Import from GitHub">
        <div className="flex gap-2">
          <input
            className={inputClass}
            onChange={(event) => setImportUrl(event.target.value)}
            placeholder="https://github.com/owner/repository"
            type="url"
            value={importUrl}
          />
          <button
            className={buttonClass}
            disabled={!importUrl.trim() || importing}
            onClick={() => void previewImport()}
            type="button"
          >
            Preview
          </button>
        </div>
        {preview.length > 0 && (
          <div className="flex flex-col gap-2 px-2 py-2">
            {preview.map((skill) => (
              <label className="flex items-start gap-2" key={skill.slug}>
                <input
                  checked={selectedSlugs.has(skill.slug)}
                  className="mt-1"
                  onChange={() =>
                    setSelectedSlugs((current) => {
                      const next = new Set(current);
                      next.has(skill.slug) ? next.delete(skill.slug) : next.add(skill.slug);
                      return next;
                    })
                  }
                  type="checkbox"
                />
                <span>
                  <strong>{skill.name}</strong>{" "}
                  <span className="text-text-light-gray">/{skill.slug}</span>
                </span>
              </label>
            ))}
            <button
              className={`${buttonClass} self-start`}
              disabled={selectedSlugs.size === 0 || importing}
              onClick={() => void confirmImport()}
              type="button"
            >
              Import selected
            </button>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title={editing ? "Edit skill" : "New skill"}>
        <textarea
          className={`${inputClass} min-h-[220px] resize-y font-mono`}
          onChange={(event) => setMarkdown(event.target.value)}
          placeholder={`---\nname: minimalist-review\ndescription: Review a decision.\nargument-hint: [describe your decision]\n---\nYour skill prompt...`}
          value={markdown}
        />
        <div className="flex gap-2">
          <button
            className={buttonClass}
            disabled={!markdown.trim() || saving}
            onClick={() => void saveMarkdown()}
            type="button"
          >
            {editing ? "Save changes" : "Create skill"}
          </button>
          {editing && (
            <button
              className={buttonClass}
              onClick={() => {
                setEditing(null);
                setMarkdown("");
              }}
              type="button"
            >
              Cancel
            </button>
          )}
        </div>
      </SettingsCard>
    </div>
  );
}

function skillToMarkdown(skill: Skill) {
  const frontmatter = [
    "---",
    `name: ${JSON.stringify(skill.name)}`,
    skill.description ? `description: ${JSON.stringify(skill.description)}` : null,
    skill.argumentHint ? `argument-hint: ${JSON.stringify(skill.argumentHint)}` : null,
    "---",
  ].filter(Boolean);
  return `${frontmatter.join("\n")}\n${skill.body}`;
}

function apiError(error: unknown) {
  if (axios.isAxiosError<{ error?: string }>(error)) {
    return error.response?.data?.error || error.message;
  }
  return error instanceof Error ? error.message : "Request failed";
}
