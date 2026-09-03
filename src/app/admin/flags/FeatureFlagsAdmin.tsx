"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { featureFlagsQueryKey } from "@/hooks/useFlag";
import type { FeatureFlagMode, FeatureFlagRow } from "@/lib/flags";

const OPTIONS: { mode: FeatureFlagMode; label: string }[] = [
  { mode: "OWNER_ONLY", label: "Only me" },
  { mode: "EVERYONE", label: "Everyone" },
  { mode: "OFF", label: "Off" },
];

async function loadFlags(): Promise<FeatureFlagRow[]> {
  const response = await fetch("/api/admin/flags", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load feature flags");
  return ((await response.json()) as { flags: FeatureFlagRow[] }).flags;
}

async function updateFlag(input: { key: string; mode: FeatureFlagMode }) {
  const response = await fetch("/api/admin/flags", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { flag?: FeatureFlagRow; error?: string };
  if (!response.ok || !body.flag) throw new Error(body.error ?? "Could not update feature flag");
  return body.flag;
}

export default function FeatureFlagsAdmin() {
  const queryClient = useQueryClient();
  const flags = useQuery({
    queryKey: ["admin-feature-flags"],
    queryFn: loadFlags,
    refetchOnWindowFocus: true,
  });
  const update = useMutation({
    mutationFn: updateFlag,
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ["admin-feature-flags"] });
      const previous = queryClient.getQueryData<FeatureFlagRow[]>(["admin-feature-flags"]);
      queryClient.setQueryData<FeatureFlagRow[]>(["admin-feature-flags"], (rows = []) =>
        rows.map((row) => (row.key === next.key ? { ...row, mode: next.mode } : row)),
      );
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(["admin-feature-flags"], context.previous);
    },
    onSuccess: (flag) => {
      queryClient.setQueryData<FeatureFlagRow[]>(["admin-feature-flags"], (rows = []) =>
        rows.map((row) => (row.key === flag.key ? flag : row)),
      );
      void queryClient.invalidateQueries({ queryKey: featureFlagsQueryKey(6) });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["admin-feature-flags"] }),
  });

  return (
    <main className="min-h-screen bg-pageBackground px-4 py-8 text-white-black sm:px-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-heading font-semibold">Feature flags</h1>
        <p className="mt-2 text-content text-text-light-gray">
          New features start with Only me. Release or hide them without a deploy.
        </p>

        <div className="mt-6 overflow-hidden rounded-[5px] border border-border-light-gray-thin bg-cardBackground">
          {flags.isLoading && <p className="p-4 text-content text-text-light-gray">Loading flags...</p>}
          {flags.isError && <p className="p-4 text-content text-destructive">Could not load feature flags.</p>}
          {flags.data?.map((flag) => (
            <div
              key={flag.key}
              className="flex flex-col gap-3 border-b border-border-light-gray-thin p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <code className="break-all text-dense text-white-black">{flag.key}</code>
              <div
                className="flex w-full rounded-sm bg-comment-description p-1 sm:w-auto"
                role="group"
                aria-label={`Mode for ${flag.key}`}
              >
                {OPTIONS.map((option) => {
                  const active = flag.mode === option.mode;
                  const pending = update.isPending && update.variables.key === flag.key;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      aria-pressed={active}
                      disabled={pending}
                      onClick={() => !active && update.mutate({ key: flag.key, mode: option.mode })}
                      className={`flex-1 rounded-sm px-3 py-2 text-dense font-medium transition-colors disabled:opacity-50 sm:flex-none ${
                        active
                          ? "bg-shadcn-primary text-primary-foreground"
                          : "text-text-light-gray hover:bg-hover-active hover:text-white-black"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {update.isError && (
          <p role="alert" className="mt-3 text-content text-destructive">
            {update.error.message}
          </p>
        )}
      </div>
    </main>
  );
}
