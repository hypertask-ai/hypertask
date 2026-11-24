"use client";

import { blockedViewRule } from "@/lib/constants/builtinViews";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_9361_BLOCKED_VIEW_DONE_FLAG } from "@/lib/flags/definitions/htpr-9361-blocked-view-done";

export default function BlockedViewRule({ activeViewId }: { activeViewId?: string }) {
  const leaveFinishedOut = useFlag(HTPR_9361_BLOCKED_VIEW_DONE_FLAG);
  const rule = leaveFinishedOut ? blockedViewRule(activeViewId) : null;
  if (!rule) return null;
  return (
    <p className="w-[97%] text-dense text-text-light-gray" data-testid="blocked-view-rule">
      {rule}
    </p>
  );
}
