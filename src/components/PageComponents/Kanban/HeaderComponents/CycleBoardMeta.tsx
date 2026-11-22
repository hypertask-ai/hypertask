"use client";

import type { IProject } from "@/models/model";
import { blockedViewRule, BUILTIN_VIEW_IDS } from "@/lib/constants/builtinViews";
import { cycleDateRange, cycleDaysLeft, resolveCycleWindow } from "@/lib/cycles";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_9361_BLOCKED_VIEW_DONE_FLAG } from "@/lib/flags/definitions/htpr-9361-blocked-view-done";

export default function CycleBoardMeta({
  activeViewId,
  project,
}: {
  activeViewId?: string;
  project: IProject;
}) {
  const leaveFinishedOut = useFlag(HTPR_9361_BLOCKED_VIEW_DONE_FLAG);
  const rule = leaveFinishedOut ? blockedViewRule(activeViewId) : null;
  if (rule) {
    return (
      <p className="w-[97%] text-dense text-text-light-gray" data-testid="blocked-view-rule">
        {rule}
      </p>
    );
  }

  if (
    !project.cyclesEnabled ||
    (activeViewId !== BUILTIN_VIEW_IDS.currentCycle &&
      activeViewId !== BUILTIN_VIEW_IDS.nextCycle)
  ) {
    return null;
  }

  const window = resolveCycleWindow(project.cycles ?? []);
  const cycle = activeViewId === BUILTIN_VIEW_IDS.currentCycle ? window.current : window.next;
  if (!cycle) return null;
  const daysLeft = cycleDaysLeft(cycle);

  return (
    <p className="w-[97%] text-dense text-text-light-gray" data-testid="cycle-board-meta">
      <strong className="font-medium text-white-black">Cycle {cycle.number}</strong>
      {" · "}{cycleDateRange(cycle)}
      {activeViewId === BUILTIN_VIEW_IDS.currentCycle && (
        <>{" · "}{daysLeft} {daysLeft === 1 ? "day" : "days"} left</>
      )}
    </p>
  );
}
