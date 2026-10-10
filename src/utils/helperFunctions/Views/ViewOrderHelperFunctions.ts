import type { IView } from "@/models/model";
import {
  BUILTIN_VIEWS,
  BUILTIN_VIEW_IDS,
  isBuiltinView,
  type BoardView,
} from "@/lib/constants/builtinViews";

export const asViewOrder = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((id) => typeof id === "string")
    ? value
    : undefined;

// Views the user has never dragged fall back to creation order. Built-ins have
// no createdAt, so they rank after every saved view, in declaration order --
// their first-run home at the end of the bar, until the user moves them.
const BUILTIN_RANK_BASE = Number.MAX_SAFE_INTEGER - BUILTIN_VIEWS.length;

// HTPR-7092: Decisions sits right after the home tab until the user places it.
const fallbackRank = (view: BoardView) => {
  if (view.id === BUILTIN_VIEW_IDS.decisions) return -1;
  if (isBuiltinView(view)) {
    return (
      BUILTIN_RANK_BASE + BUILTIN_VIEWS.findIndex((item) => item.id === view.id)
    );
  }
  return new Date((view as IView).createdAt as any).getTime() || 0;
};

export const sortViewsByOrder = <T extends BoardView>(
  views: T[],
  order: string[] | undefined,
  defaultViewId: string | undefined
) => {
  const orderIndex = new Map((order ?? []).map((id, index) => [id, index]));

  return [...views].sort((a, b) => {
    if (a.id === defaultViewId) return -1;
    if (b.id === defaultViewId) return 1;

    const aIndex = orderIndex.get(a.id) ?? (a.id === BUILTIN_VIEW_IDS.decisions ? -1 : undefined);
    const bIndex = orderIndex.get(b.id) ?? (b.id === BUILTIN_VIEW_IDS.decisions ? -1 : undefined);
    if (aIndex !== undefined || bIndex !== undefined) {
      return (aIndex ?? Infinity) - (bIndex ?? Infinity);
    }

    const aRank = fallbackRank(a);
    const bRank = fallbackRank(b);
    if (aRank !== bRank) return aRank - bRank;
    return a.id.localeCompare(b.id);
  });
};
