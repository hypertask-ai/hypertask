import type { IProject } from "@/models/model";
import { BUILTIN_VIEW_IDS } from "@/lib/constants/builtinViews";
import { cycleDateRange, cycleDaysLeft, resolveCycleWindow } from "@/lib/cycles";

export default function CycleBoardMeta({
  activeViewId,
  project,
}: {
  activeViewId?: string;
  project: IProject;
}) {
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
