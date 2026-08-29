import { ReactNode } from "react";

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
