import type { IProject } from "@/models/model";
import { BUILTIN_VIEW_IDS, getBuiltinView } from "@/lib/constants/builtinViews";
import { cycleDateRange, cycleDaysLeft, resolveCycleWindow } from "@/lib/cycles";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_9361_BLOCKED_SKIPS_DONE_FLAG } from "@/lib/flags/definitions/htpr-9361-blocked-skips-done";

export default function CycleBoardMeta({
  activeViewId,
  project,
}: {
  activeViewId?: string;
  project: IProject;
}) {
  const ruleEnabled = useFlag(HTPR_9361_BLOCKED_SKIPS_DONE_FLAG);
  const rule = ruleEnabled ? getBuiltinView(activeViewId)?.rule : undefined;

  if (
    !project.cyclesEnabled ||
    (activeViewId !== BUILTIN_VIEW_IDS.currentCycle &&
      activeViewId !== BUILTIN_VIEW_IDS.nextCycle)
  ) {
    return rule ? (
      <p
        className="w-[97%] text-dense text-text-light-gray"
        data-testid="builtin-view-rule"
      >
        {rule}
      </p>
    ) : null;
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
