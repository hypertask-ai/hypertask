"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ADMIN_FEATURE_FLAGS_QUERY_KEY,
  FEATURE_FLAGS_QUERY_PREFIX,
  useFlag,
} from "@/hooks/useFlag";
import type { FeatureFlagMode, FeatureFlagRow } from "@/lib/flags";
import { clusterFeatureFlagsByReleaseDate } from "@/lib/flags/cluster";

const ADMIN_FLAGS_ROUTE = "/api/admin/flags";
const OPTIONS: { mode: FeatureFlagMode; label: string }[] = [
  { mode: "OWNER_ONLY", label: "Only me" },
  { mode: "OWNER_AND_QA", label: "Owner + QA" },
  { mode: "EVERYONE", label: "Everyone" },
  { mode: "OFF", label: "Off" },
];
const AUDIENCE_FILTERS: { mode: FeatureFlagMode | "ALL"; label: string }[] = [
  { mode: "ALL", label: "All" },
  ...OPTIONS,
];

type AdminFeatureFlags = {
  flags: FeatureFlagRow[];
  detailsEnabled: boolean;
};

async function loadFlags(): Promise<AdminFeatureFlags> {
  const response = await fetch(ADMIN_FLAGS_ROUTE, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load feature flags");
  return (await response.json()) as AdminFeatureFlags;
}

async function updateFlag(input: { key: string; mode: FeatureFlagMode }) {
  const response = await fetch(ADMIN_FLAGS_ROUTE, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => {
    throw new Error("Could not update feature flag");
  });
  const body = (await response.json().catch(() => null)) as {
    flag?: FeatureFlagRow;
    error?: string;
  } | null;
  if (!response.ok || !body?.flag) throw new Error(body?.error ?? "Could not update feature flag");
  return body.flag;
}

export default function FeatureFlagsAdmin() {
  const queryClient = useQueryClient();
  const ticketTitleEnabled = useFlag("htpr-6176-flag-ticket-title");
  const sortFilterEnabled = useFlag("htpr-6179-flag-sort-filter");
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");
  const [audienceFilter, setAudienceFilter] = useState<FeatureFlagMode | "ALL">("ALL");
  const flags = useQuery({
    queryKey: ADMIN_FEATURE_FLAGS_QUERY_KEY,
    queryFn: loadFlags,
    refetchOnWindowFocus: true,
  });
  const update = useMutation({
    mutationFn: updateFlag,
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_FEATURE_FLAGS_QUERY_KEY });
      const previous = queryClient.getQueryData<AdminFeatureFlags>(ADMIN_FEATURE_FLAGS_QUERY_KEY);
      queryClient.setQueryData<AdminFeatureFlags>(ADMIN_FEATURE_FLAGS_QUERY_KEY, (current) =>
        current
          ? {
              ...current,
              flags: current.flags.map((flag) =>
                flag.key === next.key ? { ...flag, mode: next.mode } : flag,
              ),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(ADMIN_FEATURE_FLAGS_QUERY_KEY, context.previous);
    },
    onSuccess: (flag) => {
      queryClient.setQueryData<AdminFeatureFlags>(ADMIN_FEATURE_FLAGS_QUERY_KEY, (current) =>
        current
          ? {
              ...current,
              flags: current.flags.map((row) => (row.key === flag.key ? flag : row)),
            }
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_PREFIX });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ADMIN_FEATURE_FLAGS_QUERY_KEY }),
  });

  // Off: one unlabelled group, so the rows below render exactly as they did before.
  const clusters = useMemo(
    () =>
      sortFilterEnabled
        ? clusterFeatureFlagsByReleaseDate(flags.data?.flags ?? [], sortDirection, audienceFilter)
        : [["", flags.data?.flags ?? []] as [string, FeatureFlagRow[]]],
    [sortFilterEnabled, flags.data?.flags, sortDirection, audienceFilter],
  );

  return (
    <main className="min-h-screen bg-pageBackground px-4 py-8 text-white-black sm:px-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-heading font-semibold">Feature flags</h1>
        <p className="mt-2 text-content text-text-light-gray">
          New features start with Owner + QA. Release or hide them without a deploy.
        </p>

        {sortFilterEnabled && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div
              className="flex flex-wrap gap-1 rounded-sm bg-comment-description p-1"
              role="group"
              aria-label="Filter by audience"
            >
              {AUDIENCE_FILTERS.map((filter) => (
                <button
                  key={filter.mode}
                  type="button"
                  aria-pressed={audienceFilter === filter.mode}
                  onClick={() => setAudienceFilter(filter.mode)}
                  className={`rounded-sm px-3 py-1.5 text-dense font-medium transition-colors ${
                    audienceFilter === filter.mode
                      ? "bg-shadcn-primary text-primary-foreground"
                      : "text-text-light-gray hover:bg-hover-active hover:text-white-black"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSortDirection((current) => (current === "desc" ? "asc" : "desc"))}
              className="rounded-sm border border-border-light-gray-thin px-3 py-1.5 text-dense font-medium text-text-light-gray hover:bg-hover-active hover:text-white-black"
            >
              {sortDirection === "desc" ? "Newest first" : "Oldest first"}
            </button>
          </div>
        )}

        {(flags.isLoading || flags.isError || clusters.every(([, rows]) => rows.length === 0)) && (
          <div className="mt-6 overflow-hidden rounded-[5px] border border-border-light-gray-thin bg-cardBackground">
            {flags.isLoading && <p className="p-4 text-content text-text-light-gray">Loading flags...</p>}
            {flags.isError && <p className="p-4 text-content text-destructive">Could not load feature flags.</p>}
            {!flags.isLoading && !flags.isError && (
              <p className="p-4 text-content text-text-light-gray">No flags match this filter.</p>
            )}
          </div>
        )}

        {clusters.map(([dateLabel, rows]) =>
          rows.length === 0 ? null : (
          <div key={dateLabel || "all"} className="mt-6">
            {sortFilterEnabled && (
              <h2 className="mb-2 text-dense font-semibold text-text-light-gray">{dateLabel}</h2>
            )}
            <div className="overflow-hidden rounded-[5px] border border-border-light-gray-thin bg-cardBackground">
          {rows.map((flag) => (
            <div
              key={flag.key}
              className="flex flex-col gap-3 border-b border-border-light-gray-thin p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 sm:max-w-lg">
                {flags.data?.detailsEnabled && ticketTitleEnabled && flag.ticketTitle ? (
                  <>
                    {flag.ticketUrl ? (
                      <a
                        href={flag.ticketUrl}
                        className="text-content font-medium text-white-black underline-offset-2 hover:underline focus-visible:underline"
                      >
                        {flag.ticketTitle}
                      </a>
                    ) : (
                      <p className="text-content font-medium text-white-black">{flag.ticketTitle}</p>
                    )}
                    <code className="mt-1 block break-all text-dense text-text-light-gray">{flag.key}</code>
                  </>
                ) : flags.data?.detailsEnabled && flag.ticketUrl ? (
                  <a
                    href={flag.ticketUrl}
                    className="text-white-black underline-offset-2 hover:underline focus-visible:underline"
                  >
                    <code className="break-all text-dense">{flag.key}</code>
                  </a>
                ) : (
                  <code className="break-all text-dense text-white-black">{flag.key}</code>
                )}
                {flags.data?.detailsEnabled && (
                  <p className="mt-1 text-content text-text-light-gray">{flag.description}</p>
                )}
              </div>
              <div
                className="flex w-full shrink-0 rounded-sm bg-comment-description p-1 sm:w-auto"
                role="group"
                aria-label={`Mode for ${flag.key}`}
              >
                {OPTIONS.map((option) => {
                  const active = flag.mode === option.mode;
                  const pending = update.isPending;
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
          </div>
          ),
        )}
        {update.isError && (
          <p role="alert" className="mt-3 text-content text-destructive">
            {update.error.message}
          </p>
        )}
      </div>
    </main>
  );
}
