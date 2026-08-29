import { useTaskTime } from "@/hooks/Task Detail/useTimeTracking";
import { useTimerNow } from "@/hooks/Task Detail/useTimeTracking";
import { formatElapsed } from "@/lib/timeDuration";

const RunningTimerIndicator = ({ taskId }: { taskId: number }) => {
  const { data } = useTaskTime(taskId);
  const now = useTimerNow(!!data?.runningEntry && !data.runningEntry.pausedAt);
  if (!data?.enabled || !data.runningEntry) return null;

  const end = data.runningEntry.pausedAt
    ? new Date(data.runningEntry.pausedAt).getTime()
    : now;
  const elapsed = Math.floor(
    (end - new Date(data.runningEntry.startedAt).getTime()) / 1000
  );

  return (
    <span className="flex shrink-0 items-center gap-1 text-meta font-normal text-text-light-gray">
      <span className="text-hypertasks-green">●</span>
      {formatElapsed(elapsed)}
    </span>
  );
};

export default RunningTimerIndicator;
