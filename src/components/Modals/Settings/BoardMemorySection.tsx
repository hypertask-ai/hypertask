"use client";

import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type { ReactNode } from "react";

import { boardMemoryRoute } from "@/lib/constants/APIRouteConstants";

import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";
import { useSettingsTeam } from "./useSettingsTeam";

type BoardMemory = {
  content: string;
  createdAt: string;
  source: string;
};

type BoardMemoryState = {
  enabled: boolean;
  memories: BoardMemory[];
};

const boardMemoryQueryKey = (projectId: number | undefined) => [
  "board-memory",
  projectId,
];

const formatLearnedAt = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));

export default function BoardMemorySection() {
  const { project } = useSettingsTeam();
  const projectId = project?.id;
  const queryClient = useQueryClient();
  const queryKey = boardMemoryQueryKey(projectId);
  const { data, isError, isLoading } = useQuery({
    enabled: Boolean(projectId),
    queryKey,
    queryFn: async () =>
      (
        await axios.get<BoardMemoryState>(boardMemoryRoute, {
          params: { projectId },
        })
      ).data,
  });
  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      (
        await axios.patch<{ enabled: boolean }>(boardMemoryRoute, {
          enabled,
          projectId,
        })
      ).data,
    onSuccess: ({ enabled }) => {
      queryClient.setQueryData<BoardMemoryState>(queryKey, (current) =>
        current ? { ...current, enabled } : current,
      );
    },
    onError: () => toast.error("Unable to update board memory"),
  });
  const deleteMutation = useMutation({
    mutationFn: async (source: string) => {
      await axios.delete(boardMemoryRoute, {
        params: { projectId, source },
      });
      return source;
    },
    onSuccess: (source) => {
      queryClient.setQueryData<BoardMemoryState>(queryKey, (current) =>
        current
          ? {
              ...current,
              memories: current.memories.filter(
                (memory) => memory.source !== source,
              ),
            }
          : current,
      );
    },
    onError: () => toast.error("Unable to delete this memory"),
  });

  if (!project) return null;

  let content: ReactNode;
  if (isError) {
    content = (
      <p className="text-dense text-text-light-gray">
        Board memory could not be loaded. Open this section again to retry.
      </p>
    );
  } else if (isLoading || !data) {
    content = (
      <p className="text-dense text-text-light-gray">Loading memory...</p>
    );
  } else {
    content = (
      <>
        <SettingsCard>
          <SettingsToggle
            checked={data.enabled}
            description="Learn from AI draft corrections and edited AI titles, then reuse those facts in Task Writer and HyperAI."
            disabled={toggleMutation.isPending}
            inputId="board-memory-enabled"
            label="Learn from AI corrections"
            onChange={() => toggleMutation.mutate(!data.enabled)}
          />
          {!data.enabled && data.memories.length > 0 ? (
            <p className="px-2 text-dense text-text-light-gray">
              Saved memories stay here, but AI will not recall them while
              learning is off.
            </p>
          ) : null}
        </SettingsCard>

        <SettingsCard title="Learned facts">
          {data.memories.length === 0 ? (
            <p className="px-2 text-dense text-text-light-gray">
              No learned facts yet. Clear corrections and edited AI titles will
              appear here for review.
            </p>
          ) : (
            <div className="flex flex-col">
              {data.memories.map((memory) => (
                <div
                  className="flex min-h-[44px] items-start gap-4 border-b border-light-black-border-1 px-2 py-2"
                  key={memory.source}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-dense font-medium text-white-black">
                      {memory.content}
                    </p>
                    <p className="text-meta text-text-light-gray">
                      Learned {formatLearnedAt(memory.createdAt)}
                    </p>
                  </div>
                  <button
                    className="shrink-0 px-2 py-1 text-meta text-text-light-gray hover:text-white-black focus-visible:outline-none disabled:opacity-50"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(memory.source)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </SettingsCard>
      </>
    );
  }

  return (
    <SettingsSectionShell
      description={`Let AI learn and reuse terminology and preferences for ${project.title ?? project.name}.`}
      title="Memory"
    >
      {content}
    </SettingsSectionShell>
  );
}
