import { freePlanLimitCopy, type FreePlanLimitFlags } from "@/lib/freePlanLimits";
import { ReactNode } from "react";

export function FreePlanLimitLines({
  flags,
  align = "end",
}: {
  flags: FreePlanLimitFlags;
  align?: "end" | "start" | "center";
}) {
  const alignment = {
    start: "items-start text-left",
    center: "items-center text-center",
    end: "items-end text-right",
  }[align];
  return (
    <span className={`flex flex-col ${alignment}`}>
      {freePlanLimitCopy(flags).map((line) => (
        <span key={line} className="block text-dense font-medium text-text-light-gray">
          {line}
        </span>
      ))}
    </span>
  );
}

export const settingsActionButtonClass =
  "inline-flex items-center rounded-[5px] px-2 py-1 text-dense font-semibold text-white-black transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-light-gray";

export const BillingRow = ({
  label,
  value,
}: {
  label: string;
  value: string;
}) => (
  <div className="flex items-center justify-between gap-4 rounded-[5px] px-2 py-2 hover:bg-hover-active">
    <span className="shrink-0 text-dense font-semibold text-white-black">
      {label}
    </span>
    <span className="min-w-0 truncate text-right text-dense font-medium text-text-light-gray">
      {value}
    </span>
  </div>
);

export const BillingActionRow = ({
  action,
  label,
}: {
  action: ReactNode;
  label: string;
}) => (
  <div className="flex items-center justify-between gap-4 rounded-[5px] px-2 py-2 hover:bg-hover-active">
    <span className="shrink-0 text-dense font-semibold text-white-black">
      {label}
    </span>
    {action}
  </div>
);
