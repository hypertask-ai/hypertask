"use client";

import { useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7472_TASK_TEMPLATES_FLAG } from "@/lib/flags/keys";
import { readTaskTemplateDescription, writeTaskTemplateDescription } from "@/lib/taskTemplateEditing";
import AICustomPromptInput from "@/components/Modals/AICustomPrompt/AICustomPromptInput";
import { ActionButton } from "@/components/Modals/AICustomPrompt/ActionRow";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsCard from "./SettingsCard";
import { useSettingsTeam } from "./useSettingsTeam";

interface TaskTemplate {
  id: number;
  name: string;
  title: string;
  descriptionHtml: string;
}

const BoardTaskTemplatesSection = () => {
  const { project } = useSettingsTeam();
  const enabled = useFlag(HTPR_7472_TASK_TEMPLATES_FLAG);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<(TaskTemplate & { text: string; projectId: number }) | null>(null);
  const queryKey = ["task-templates", project?.id];
  const { data, isLoading, isError } = useQuery({
    queryKey,
    enabled: enabled && Boolean(project),
    queryFn: async () => (await axios.get<{ templates: TaskTemplate[] }>("/api/task-templates", {
      params: { projectId: project!.id },
    })).data,
  });
  const mutation = useMutation({
    mutationFn: async (template: NonNullable<typeof editing>) => {
      await axios.patch("/api/task-templates", {
        templateId: template.id,
        name: template.name,
        title: template.title,
        descriptionHtml: writeTaskTemplateDescription(template.text, template.descriptionHtml),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["task-templates"] });
      setEditing(null);
      toast.success("Template saved");
    },
    onError: () => toast.error("Unable to save template"),
  });

  if (!project) return null;

  const editor = editing?.projectId === project.id ? editing : null;
  if (enabled && editor) {
    const description = readTaskTemplateDescription(editor.descriptionHtml);
    return (
      <SettingsSectionShell title={`${editor.name} template`}>
        <button
          className="self-start px-2 text-dense font-medium text-text-light-gray hover:text-white-black"
          disabled={mutation.isPending}
          onClick={() => setEditing(null)}
          type="button"
        >
          ‹ Task templates
        </button>
        <SettingsCard>
          {([ ["name", "Template name"], ["title", "Title pattern"] ] as const).map(([field, label]) => (
            <div className="flex items-center justify-between gap-4 border-b border-light-black-border-1 px-2 py-2" key={field}>
              <label className="shrink-0 text-dense font-semibold text-white-black" htmlFor={`template-${field}`}>
                {label}
              </label>
              <input
                className="h-8 min-w-0 flex-1 rounded-[4px] border-0 bg-transparent px-2 text-right text-dense font-medium text-white-black outline-none placeholder:text-text-light-gray focus:bg-active-modal-element"
                disabled={mutation.isPending}
                id={`template-${field}`}
                maxLength={field === "name" ? 200 : 500}
                onChange={(event) => setEditing({ ...editor, [field]: event.target.value })}
                value={editor[field]}
              />
            </div>
          ))}
          <label className="px-2 text-dense font-semibold text-white-black" htmlFor="template-description">
            Description structure
          </label>
          <AICustomPromptInput
            id="template-description"
            onChange={(event) => setEditing({ ...editor, text: event.target.value })}
            placeholder="Template description"
            readOnly={!description.editable || mutation.isPending}
            value={editor.text}
          />
          {!description.editable && (
            <p className="px-2 text-dense font-medium text-text-light-gray">
              This description has rich formatting and is read-only here to preserve it.
            </p>
          )}
          <footer className="flex self-end px-2 py-2">
            <ActionButton disabled={mutation.isPending} onClick={() => setEditing(null)}>Cancel</ActionButton>
            <button
              className="ml-2 inline-flex w-fit items-center gap-2 rounded-[4px] bg-shadcn-primary px-4 py-2 font-semibold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={mutation.isPending || !editor.name.trim()}
              onClick={() => mutation.mutate(editor)}
              type="button"
            >
              Save template
            </button>
          </footer>
        </SettingsCard>
      </SettingsSectionShell>
    );
  }

  return enabled ? (
    <SettingsSectionShell title="Task templates">
      <SettingsCard>
        {isLoading && <p className="px-2 text-dense text-text-light-gray">Loading templates…</p>}
        {isError && <p className="px-2 text-dense text-text-light-gray">Unable to load templates.</p>}
        {data?.templates.map((template) => (
          <button
            className="flex min-h-[40px] items-center justify-between gap-4 border-b border-light-black-border-1 px-2 py-2 text-left transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none"
            key={template.id}
            onClick={() => setEditing({ ...template, projectId: project.id, text: readTaskTemplateDescription(template.descriptionHtml).text })}
            type="button"
          >
            <span className="min-w-0">
              <span className="block truncate text-dense font-semibold text-white-black">{template.name}</span>
              <span className="block truncate text-dense font-medium text-text-light-gray">
                {[...readTaskTemplateDescription(template.descriptionHtml).headings, template.title].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="shrink-0 text-dense font-medium text-text-light-gray">Edit ›</span>
          </button>
        ))}
        {data?.templates.length === 0 && (
          <p className="px-2 text-dense font-medium text-text-light-gray">
            Save a ticket as a template with Ctrl+K “Save as template”.
          </p>
        )}
      </SettingsCard>
      <p className="px-2 text-dense font-medium text-text-light-gray">
        Board knowledge stays in Custom instructions, Memory and Files. You do not need to paste it into each template.
      </p>
    </SettingsSectionShell>
  ) : null;
};

export default BoardTaskTemplatesSection;
