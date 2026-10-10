"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ADMIN_FEATURE_FLAGS_QUERY_KEY,
  FEATURE_FLAGS_QUERY_PREFIX,
  useFlag,
} from "@/hooks/useFlag";
import OptionPickerModal from "@/components/Modals/OptionPicker";
import LabelWrapper from "@/components/Labels/LabelWrapper";
import { ModalInput } from "@/components/Common/CommonModalComponents";
import { HTPR_6964_FLAGS_PAGE_TYPE_SEARCH_FLAG, HTPR_7058_FLAGS_PAGE_URL_FILTERS_FLAG, HTPR_7069_FLAGS_DROPDOWN_FILTERS_FLAG } from "@/lib/flags/keys";
import { matchesFeatureFlagSearch, relatedFeatureFlags } from "@/lib/flags/discovery";
import type { FeatureFlagMode, FeatureFlagRow, FeatureFlagKind } from "@/lib/flags";
import {
  clusterFeatureFlagsByReleaseDate,
  countFeatureFlagsByAudience,
  isUnreleasedFeatureFlag,
  type FeatureFlagAudienceFilter,
} from "@/lib/flags/cluster";
import { featureFlagRemovalState } from "@/lib/flags/removal";
import { FLAG_FILTER_KINDS, flagDaysWaiting, matchesFlagKind, matchesFlagRisk, useFlagsPageFilters, type FlagsPageFilters } from "./useFlagsPageFilters";

import { FEATURE_FLAG_RELEASE_RISKS, RELEASE_RISK_LABELS, RELEASE_RISK_ORDER } from "@/lib/flags/releaseRisk";

const ADMIN_FLAGS_ROUTE = "/api/admin/flags";
const KIND_LABELS: Record<FeatureFlagKind, string> = {
  bugfix: "Bug",
  feature: "Feature",
  improvement: "Improvement",
};
const OPTIONS: { mode: FeatureFlagMode; label: string }[] = [
  { mode: "OWNER_ONLY", label: "Only me" },
  { mode: "OWNER_AND_QA", label: "Owner + QA" },
  { mode: "EVERYONE", label: "Everyone" },
  { mode: "OFF", label: "Off" },
];
const AUDIENCE_FILTERS: { mode: FeatureFlagAudienceFilter; label: string }[] = [
  { mode: "ALL", label: "All" },
  { mode: "UNRELEASED", label: "Unreleased" },
  ...OPTIONS,
];

type FlagFilterDropdown = {
  label: string;
  multiple: boolean;
  selected: string[];
  allCount?: number;
  options: { value: string; label: string; count: number }[];
  onChange: (selected: string[]) => void;
};

// Trigger button plus the shared OptionPickerModal. Single selects close on pick; multi selects stay open.
function FlagFilterPicker({ label, multiple, selected, allCount, options, onChange }: FlagFilterDropdown) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const summary = selected.length === 0
    ? "All"
    : options.filter((option) => selected.includes(option.value)).map((option) => option.label).join(", ");
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const pickerOptions = [
    ...(multiple ? [{ id: "", label: `All (${allCount ?? 0})`, checked: selected.length === 0 }] : []),
    ...options.map((option) => ({ id: option.value, label: `${option.label} (${option.count})`, checked: selected.includes(option.value) })),
  ];
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={`Filter ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="max-w-full flex-1 basis-40 truncate rounded-sm px-3 py-1.5 text-left text-dense font-medium text-text-light-gray hover:bg-hover-active hover:text-white-black"
      >
        {label}: {summary}
      </button>
      {open && (
        <OptionPickerModal
          header={label}
          options={pickerOptions}
          onSelect={(option) => {
            const value = String(option.id ?? "");
            if (!multiple) {
              onChange([value]);
              close();
            } else if (value === "") {
              onChange([]);
            } else {
              onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
            }
          }}
          onClose={close}
        />
      )}
    </>
  );
}

type AdminFeatureFlags = {
  flags: FeatureFlagRow[];
  detailsEnabled: boolean;
};

async function loadFlags(): Promise<AdminFeatureFlags> {
  const response = await fetch("/api/admin/flags", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load feature flags");
  return (await response.json()) as AdminFeatureFlags;
}

type FlagUpdate = { key: string; mode: FeatureFlagMode } | { key: string; keep: boolean };

async function updateFlag(input: FlagUpdate) {
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

export default function FeatureFlagsAdmin({
  flagKey,
}: {
  flagKey?: string;
}) {
  const queryClient = useQueryClient();
  const discoveryEnabled = useFlag(HTPR_6964_FLAGS_PAGE_TYPE_SEARCH_FLAG);
  const dropdownFiltersEnabled = useFlag(HTPR_7069_FLAGS_DROPDOWN_FILTERS_FLAG);
  const existingUrlFiltersEnabled = useFlag(HTPR_7058_FLAGS_PAGE_URL_FILTERS_FLAG);
  const urlFiltersEnabled = existingUrlFiltersEnabled || dropdownFiltersEnabled;
  const { filters, change, changeSearch: setSearch, commitSearch } = useFlagsPageFilters(urlFiltersEnabled && !flagKey, dropdownFiltersEnabled);
  const { search, sort: sortDirection, audience: audienceFilter, kinds, risk } = filters;
  const setAudienceFilter = (audience: FeatureFlagAudienceFilter) => change({ ...filters, audience });
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
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
                flag.key === next.key ? { ...flag, ...next } : flag,
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

  const counts = useMemo(
    () => countFeatureFlagsByAudience(flags.data?.flags ?? [], urlFiltersEnabled),
    [flags.data?.flags, urlFiltersEnabled],
  );
  const clusters = useMemo(
    () => {
      if (flagKey) {
        return [["", (flags.data?.flags ?? []).filter((flag) => flag.key === flagKey)] as [string, FeatureFlagRow[]]];
      }
      const rows = flags.data?.flags ?? [];
      return clusterFeatureFlagsByReleaseDate(
        rows.filter((flag) => (
          (!(discoveryEnabled || urlFiltersEnabled) || matchesFeatureFlagSearch(flag, search))
          && (!urlFiltersEnabled || (matchesFlagKind(flag, kinds) && matchesFlagRisk(flag, risk)))
        )),
        sortDirection,
        audienceFilter,
        { shippedOnly: urlFiltersEnabled && sortDirection !== "desc", unreleasedOnly: urlFiltersEnabled },
      );
    },
    [flagKey, flags.data?.flags, sortDirection, audienceFilter, discoveryEnabled, urlFiltersEnabled, search, kinds, risk],
  );

  const shownCount = clusters.reduce((total, [, rows]) => total + rows.length, 0);
  const allRows = flags.data?.flags ?? [];
  const selectedRisks = risk === null ? [] : Array.isArray(risk) ? risk : [risk];
  // Each dropdown counts what its options would show with every other filter and the search applied.
  const searchedRows = allRows.filter((flag) => matchesFeatureFlagSearch(flag, search));
  const inAudience = (flag: FeatureFlagRow) => audienceFilter === "ALL" ? true
    : audienceFilter === "UNRELEASED" ? (urlFiltersEnabled ? isUnreleasedFeatureFlag(flag) : flag.mode !== "EVERYONE")
      : flag.mode === audienceFilter;
  const statusCounts = countFeatureFlagsByAudience(
    searchedRows.filter((flag) => matchesFlagKind(flag, kinds) && matchesFlagRisk(flag, risk)), urlFiltersEnabled,
  );
  const dropdowns = [
    {
      label: "Status", multiple: false, selected: [audienceFilter],
      options: AUDIENCE_FILTERS.map(({ mode, label }) => ({ value: mode, label, count: statusCounts[mode] })),
      onChange: ([audience]: string[]) => setAudienceFilter(audience as FeatureFlagAudienceFilter),
    },
    {
      label: "Type", multiple: true, selected: kinds,
      allCount: searchedRows.filter((flag) => inAudience(flag) && matchesFlagRisk(flag, risk)).length,
      options: FLAG_FILTER_KINDS.map((kind) => ({
        value: kind, label: KIND_LABELS[kind],
        count: searchedRows.filter((flag) => inAudience(flag) && matchesFlagRisk(flag, risk) && matchesFlagKind(flag, [kind])).length,
      })),
      onChange: (selected: string[]) => change({ ...filters, kinds: selected as FeatureFlagKind[] }),
    },
    {
      label: "Release risk", multiple: true, selected: selectedRisks,
      allCount: searchedRows.filter((flag) => inAudience(flag) && matchesFlagKind(flag, kinds)).length,
      options: RELEASE_RISK_ORDER.map((value) => ({
        value, label: RELEASE_RISK_LABELS[value],
        count: searchedRows.filter((flag) => inAudience(flag) && matchesFlagKind(flag, kinds) && matchesFlagRisk(flag, value)).length,
      })),
      onChange: (selected: string[]) => change({ ...filters, risk: (selected.length > 1 ? selected : selected[0] ?? null) as FlagsPageFilters["risk"] }),
    },
    {
      label: "Sort", multiple: false, selected: [sortDirection],
      options: [
        { value: "risk", label: "Release risk first", count: shownCount },
        { value: "desc", label: "Newest first", count: shownCount },
        { value: "asc", label: "Oldest first", count: shownCount },
      ],
      onChange: ([sort]: string[]) => change({ ...filters, sort: sort as FlagsPageFilters["sort"] }),
    },
  ];

  useEffect(() => {
    if (!discoveryEnabled || flagKey) return;
    const hash = window.location.hash;
    if (hash.startsWith("#flag-")) setHighlightedKey(hash.slice(6));
  }, [discoveryEnabled, flagKey]);

  useEffect(() => {
    if (!discoveryEnabled || !highlightedKey) return;
    const card = document.getElementById(`flag-${highlightedKey}`);
    card?.scrollIntoView({ behavior: "smooth", block: "start" });
    card?.focus({ preventScroll: true });
  }, [discoveryEnabled, highlightedKey, flags.isLoading]);

  const searchInput = (
    <>
      <label htmlFor="flag-search" className="sr-only">Search flags</label>
      <ModalInput
        id="flag-search"
        autofocus={false}
        onBlur={urlFiltersEnabled ? commitSearch : undefined}
        className="rounded-sm bg-comment-description px-3"
        placeholder="Search by ticket ID or words…"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setHighlightedKey(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setSearch("");
            setHighlightedKey(null);
          }
        }}
      />
    </>
  );

  return (
    <main className="min-h-screen bg-pageBackground px-4 py-8 text-white-black sm:px-8">
      <div className="mx-auto max-w-4xl">
        {flagKey && (
          <Link href="/admin/flags" className="mb-4 inline-block text-content text-text-light-gray underline-offset-2 hover:underline focus-visible:underline">
            Back to all flags
          </Link>
        )}
        <h1 className="break-all text-heading font-semibold">{flagKey ?? "Feature flags"}</h1>
        <p className="mt-2 text-content text-text-light-gray">
          New features start with Owner + QA. Release or hide them without a deploy.
        </p>

        {!flagKey && flags.data && (
          <p className="mt-2 text-content text-text-light-gray">
            {counts.UNRELEASED} unreleased {counts.UNRELEASED === 1 ? "flag" : "flags"} waiting for release
          </p>
        )}

        {(discoveryEnabled || urlFiltersEnabled) && !flagKey && (
          <div className="sticky top-0 z-10 mt-6 bg-pageBackground py-3">
            {dropdownFiltersEnabled ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">{searchInput}</div>
                <p role="status" className="text-content text-text-light-gray">Showing {shownCount} of {allRows.length} flags</p>
              </div>
            ) : searchInput}
          </div>
        )}

        {dropdownFiltersEnabled && !flagKey && (
          <div className="mt-6 flex flex-wrap gap-3" aria-label="Flag filters">
            {dropdowns.map((dropdown) => <FlagFilterPicker key={dropdown.label} {...dropdown} />)}
          </div>
        )}

        {!dropdownFiltersEnabled && !flagKey && (
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
                  {filter.label} {counts[filter.mode]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => change({ ...filters, sort: sortDirection === "risk" ? "desc" : sortDirection === "desc" ? "asc" : urlFiltersEnabled ? "risk" : "desc" })}
              className="rounded-sm border border-border-light-gray-thin px-3 py-1.5 text-dense font-medium text-text-light-gray hover:bg-hover-active hover:text-white-black"
            >
              {sortDirection === "risk" ? "Release risk first" : sortDirection === "desc" ? "Newest first" : "Oldest first"}
            </button>
          </div>
        )}

        {urlFiltersEnabled && !dropdownFiltersEnabled && !flagKey && (
          <div className="mt-3 flex flex-wrap gap-1 rounded-sm bg-comment-description p-1" role="group" aria-label="Filter by type">
            {FLAG_FILTER_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={kinds.includes(kind)}
                onClick={() => change({
                  ...filters,
                  kinds: kinds.includes(kind) ? kinds.filter((selected) => selected !== kind) : [...kinds, kind],
                })}
                className={`rounded-sm px-3 py-1.5 text-dense font-medium transition-colors ${
                  kinds.includes(kind)
                    ? "bg-hover-active text-white-black"
                    : "text-text-light-gray hover:bg-hover-active hover:text-white-black"
                }`}
              >
                {KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        )}

        {urlFiltersEnabled && !dropdownFiltersEnabled && !flagKey && (
          <div className="mt-3 flex flex-wrap gap-1 rounded-sm bg-comment-description p-1" role="group" aria-label="Filter by release risk">
            {[null, ...RELEASE_RISK_ORDER].map((value) => (
              <button
                key={value ?? "all"}
                type="button"
                aria-pressed={risk === value}
                onClick={() => change({ ...filters, risk: value })}
                className={`rounded-sm px-3 py-1.5 text-dense font-medium transition-colors ${
                  risk === value
                    ? "bg-shadcn-primary text-primary-foreground"
                    : "text-text-light-gray hover:bg-hover-active hover:text-white-black"
                }`}
              >
                {value ? RELEASE_RISK_LABELS[value] : "All risks"}
              </button>
            ))}
          </div>
        )}

        {(flags.isLoading || flags.isError || clusters.every(([, rows]) => rows.length === 0)) && (
          <div className="mt-6 overflow-hidden rounded-[5px] border border-border-light-gray-thin bg-cardBackground">
            {flags.isLoading && <p className="p-4 text-content text-text-light-gray">Loading flags...</p>}
            {flags.isError && <p className="p-4 text-content text-destructive">Could not load feature flags.</p>}
            {!flags.isLoading && !flags.isError && (
              <p className="p-4 text-content text-text-light-gray">{flagKey ? "Feature flag not found." : "No flags match this filter."}</p>
            )}
          </div>
        )}

        {clusters.map(([dateLabel, rows]) =>
          rows.length === 0 ? null : (
          <div key={dateLabel || "all"} className="mt-6">
            {!flagKey && (
              <h2 className="mb-2 text-dense font-semibold text-text-light-gray">{dateLabel}</h2>
            )}
            <div className="overflow-hidden rounded-[5px] border border-border-light-gray-thin bg-cardBackground">
          {rows.map((flag) => {
            const ticket = /^(htpr|yper4)-([1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(flag.key);
            const releaseRisk = urlFiltersEnabled ? FEATURE_FLAG_RELEASE_RISKS[flag.key] : undefined;
            const daysWaiting = urlFiltersEnabled ? flagDaysWaiting(flag) : null;
            const related = discoveryEnabled ? relatedFeatureFlags(flag, flags.data?.flags ?? []) : [];
            let cardClassName = "flex flex-col gap-3 border-b border-border-light-gray-thin p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between";
            if (discoveryEnabled) cardClassName += " scroll-mt-24";
            if (discoveryEnabled && highlightedKey === flag.key) cardClassName += " bg-hover-active";
            return (
            <div
              key={flag.key}
              id={discoveryEnabled ? `flag-${flag.key}` : undefined}
              tabIndex={discoveryEnabled ? -1 : undefined}
              className={cardClassName}
            >
              <div className="min-w-0 sm:max-w-lg">
                {(discoveryEnabled || urlFiltersEnabled) && (
                  <LabelWrapper className="mb-2">{KIND_LABELS[flag.kind ?? "feature"]}</LabelWrapper>
                )}
                {flagKey ? (
                  <>
                    <code className="break-all text-dense text-white-black">{flag.key}</code>
                    <p className="mt-1 text-content text-text-light-gray">{flag.description}</p>
                    <p className="mt-1 text-content text-text-light-gray">
                      Shipped: {flag.shippedOn ? <time dateTime={flag.shippedOn}>{flag.shippedOn}</time> : "Not recorded"}
                    </p>
                    {ticket && (
                      <a
                        href={`https://app.hypertask.ai/detail/project-${ticket[1] === "htpr" ? 15 : 4060}/${ticket[2]}`}
                        className="mt-1 inline-block text-content text-text-light-gray underline-offset-2 hover:underline focus-visible:underline"
                      >
                        {ticket[1].toUpperCase()}-{ticket[2]}
                      </a>
                    )}
                  </>
                ) : flag.ticketTitle ? (
                  <>
                    {flag.ticketUrl ? (
                      <a
                        href={flag.ticketUrl}
                        className="text-content font-medium text-white-black underline-offset-2 hover:underline focus-visible:underline"
                      >
                        {flag.ticketId && <span>{flag.ticketId} · </span>}
                        {flag.ticketTitle}
                      </a>
                    ) : (
                      <p className="text-content font-medium text-white-black">{flag.ticketTitle}</p>
                    )}
                    <Link href={`/admin/flags/${encodeURIComponent(flag.key)}`} className="mt-1 block text-text-light-gray underline-offset-2 hover:underline focus-visible:underline">
                      <code className="break-all text-dense">{flag.key}</code>
                    </Link>
                  </>
                ) : (
                  <Link href={`/admin/flags/${encodeURIComponent(flag.key)}`} className="text-white-black underline-offset-2 hover:underline focus-visible:underline">
                    <code className="break-all text-dense">{flag.key}</code>
                  </Link>
                )}
                {!flagKey && (
                  <p className="mt-1 text-content text-text-light-gray">{flag.description}</p>
                )}
                {daysWaiting !== null && (
                  <p className="mt-1 text-meta text-text-light-gray">{daysWaiting} {daysWaiting === 1 ? "day" : "days"} waiting</p>
                )}
                {releaseRisk && (
                  <div className="mt-2">
                    <LabelWrapper>{RELEASE_RISK_LABELS[releaseRisk.risk]}</LabelWrapper>
                    <p className="mt-1 text-meta text-text-light-gray">{releaseRisk.reason}</p>
                  </div>
                )}
                {related.length > 0 && (
                  <p className="mt-2 text-meta text-text-light-gray">
                    Related: {related.map((other, index) => (
                      <span key={other.key}>
                        {index > 0 && " · "}
                        <a
                          href={`${flagKey ? "/admin/flags" : ""}#flag-${other.key}`}
                          title={other.ticketTitle ?? other.description}
                          className="break-all underline underline-offset-2 hover:text-white-black focus-visible:text-white-black"
                          onClick={flagKey ? undefined : (event) => {
                            event.preventDefault();
                            change({ ...filters, search: "", audience: "ALL", kinds: [], risk: null });
                            setHighlightedKey(other.key);
                          }}
                        >
                          {other.key}
                        </a>
                      </span>
                    ))}
                  </p>
                )}
                {(() => {
                    const removal = featureFlagRemovalState(flag);
                    if (!removal) return null;
                    return (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={`text-dense ${
                            removal.kind === "due" ? "text-destructive" : "text-text-light-gray"
                          }`}
                        >
                          {removal.label}
                        </span>
                        <button
                          type="button"
                          aria-pressed={flag.keep}
                          disabled={update.isPending}
                          onClick={() => update.mutate({ key: flag.key, keep: !flag.keep })}
                          className={`rounded-sm px-2 py-0.5 text-dense font-medium transition-colors disabled:opacity-50 ${
                            flag.keep
                              ? "bg-shadcn-primary text-primary-foreground"
                              : "text-text-light-gray hover:bg-hover-active hover:text-white-black"
                          }`}
                        >
                          Keep
                        </button>
                      </div>
                    );
                  })()}
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
            );
          })}
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
