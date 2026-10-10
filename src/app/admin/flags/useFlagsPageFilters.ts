"use client";

import { useEffect, useRef, useState } from "react";
import type { FeatureFlagKind, FeatureFlagRow } from "@/lib/flags";
import { isUnreleasedFeatureFlag, type FeatureFlagAudienceFilter } from "@/lib/flags/cluster";
import { FEATURE_FLAG_RELEASE_RISKS, RELEASE_RISK_ORDER, type FeatureFlagReleaseRisk } from "@/lib/flags/releaseRisk";

const TABS: Record<string, FeatureFlagAudienceFilter> = {
  all: "ALL",
  unreleased: "UNRELEASED",
  parked: "PARKED",
  "only-me": "OWNER_ONLY",
  "owner-and-qa": "OWNER_AND_QA",
  everyone: "EVERYONE",
  off: "OFF",
};
export const FLAG_FILTER_KINDS: FeatureFlagKind[] = ["feature", "improvement", "bugfix"];

export type FlagsPageFilters = {
  audience: FeatureFlagAudienceFilter;
  kinds: FeatureFlagKind[];
  search: string;
  risk: FeatureFlagReleaseRisk["risk"] | FeatureFlagReleaseRisk["risk"][] | null;
  sort: "risk" | "desc" | "asc";
};

export function parseFlagsPageFilters(query: string, multipleRisks = false): FlagsPageFilters {
  const params = new URLSearchParams(query);
  const types = params.get("type")?.split(",") ?? [];
  const risks = RELEASE_RISK_ORDER.filter((risk) => params.get("risk")?.split(",").includes(risk));
  return {
    audience: Object.hasOwn(TABS, params.get("tab") ?? "all") ? TABS[params.get("tab") ?? "all"] : "ALL",
    kinds: FLAG_FILTER_KINDS.filter((kind) => types.includes(kind === "bugfix" ? "bug" : kind)),
    search: params.get("q") ?? "",
    risk: multipleRisks ? (risks.length > 1 ? risks : risks[0] ?? null) : RELEASE_RISK_ORDER.find((risk) => risk === params.get("risk")) ?? null,
    sort: params.get("sort") === "oldest" ? "asc" : params.get("sort") === "newest" ? "desc" : "risk",
  };
}

export function serializeFlagsPageFilters(filters: FlagsPageFilters, query = ""): string {
  const params = new URLSearchParams(query);
  for (const key of ["tab", "type", "risk", "q", "sort"]) params.delete(key);
  if (filters.audience !== "ALL") {
    params.set("tab", Object.keys(TABS).find((tab) => TABS[tab] === filters.audience)!);
  }
  const kinds = FLAG_FILTER_KINDS.filter((kind) => filters.kinds.includes(kind));
  if (kinds.length) {
    params.set("type", kinds.map((kind) => kind === "bugfix" ? "bug" : kind).join(","));
  }
  if (filters.risk) {
    const risks = Array.isArray(filters.risk) ? RELEASE_RISK_ORDER.filter((risk) => filters.risk?.includes(risk)) : [filters.risk];
    if (risks.length) params.set("risk", risks.join(","));
  }
  if (filters.search) params.set("q", filters.search);
  if (filters.sort !== "risk") params.set("sort", filters.sort === "asc" ? "oldest" : "newest");
  return params.toString();
}

export function matchesFlagKind(flag: Pick<FeatureFlagRow, "kind">, kinds: FeatureFlagKind[]): boolean {
  return kinds.length === 0 || kinds.includes(flag.kind ?? "feature");
}

export function matchesFlagRisk(flag: Pick<FeatureFlagRow, "key">, risk: FlagsPageFilters["risk"]): boolean {
  const selected = risk === null ? [] : Array.isArray(risk) ? risk : [risk];
  return selected.length === 0 || selected.some((value) => FEATURE_FLAG_RELEASE_RISKS[flag.key]?.risk === value);
}

export function flagDaysWaiting(
  flag: Pick<FeatureFlagRow, "mode" | "shippedOn" | "parked">,
  now = new Date(),
): number | null {
  if (!isUnreleasedFeatureFlag(flag) || !flag.shippedOn || !/^\d{4}-\d{2}-\d{2}$/.test(flag.shippedOn)) return null;
  const [year, month, day] = flag.shippedOn.split("-").map(Number);
  const shipped = new Date(Date.UTC(year, month - 1, day));
  if (shipped.toISOString().slice(0, 10) !== flag.shippedOn) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((today - shipped.getTime()) / 86_400_000));
}

export function useFlagsPageFilters(enabled: boolean, multipleRisks = false) {
  const [filters, setFilters] = useState<FlagsPageFilters>(() => ({ ...parseFlagsPageFilters(""), sort: "desc" }));
  const current = useRef(filters);
  const pending = useRef<{ url: string; state: unknown } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function urlFor(next: FlagsPageFilters) {
    const query = serializeFlagsPageFilters(next, window.location.search);
    return `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  }

  function commitSearch() {
    cancelTimer();
    const base = pending.current;
    if (!base) return;
    pending.current = null;
    const nextUrl = urlFor(current.current);
    // Typing replaces the current entry. Restore its original URL before pushing the finished search.
    window.history.replaceState(base.state, "", base.url);
    if (nextUrl !== base.url) window.history.pushState(base.state, "", nextUrl);
  }

  function change(next: FlagsPageFilters) {
    if (enabled) {
      commitSearch();
      const url = urlFor(next);
      if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.history.pushState(window.history.state, "", url);
      }
    }
    current.current = next;
    setFilters(next);
  }

  function changeSearch(search: string) {
    const next = { ...current.current, search };
    if (enabled) {
      pending.current ??= {
        url: `${window.location.pathname}${window.location.search}${window.location.hash}`,
        state: window.history.state,
      };
      window.history.replaceState(window.history.state, "", urlFor(next));
      cancelTimer();
      timer.current = setTimeout(commitSearch, 450);
    }
    current.current = next;
    setFilters(next);
  }

  useEffect(() => {
    if (!enabled) {
      const next: FlagsPageFilters = { ...parseFlagsPageFilters(""), sort: "desc" };
      current.current = next;
      setFilters(next);
      return;
    }
    const restore = () => {
      cancelTimer();
      pending.current = null;
      const next = parseFlagsPageFilters(window.location.search, multipleRisks);
      current.current = next;
      setFilters(next);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => {
      cancelTimer();
      pending.current = null;
      window.removeEventListener("popstate", restore);
    };
  }, [enabled, multipleRisks]);

  return { filters, change, changeSearch, commitSearch };
}
