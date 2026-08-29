import { cn } from "@/utils/undoActions/helperFuncs";

export type MemberAiUsage = {
  displayName: string;
  sharePct: number;
  userId: number | null;
};

export type PersonalAiUsageData = {
  fundingSource: "customer" | "managed" | "shared" | null;
  memberCount: number;
  memberUsage?: MemberAiUsage[];
  userSharePct: number;
};

const borrowedBarStyle = {
  backgroundColor: "rgb(245 158 11)",
  backgroundImage:
    "repeating-linear-gradient(135deg, rgba(120,53,15,0.32) 0, rgba(120,53,15,0.32) 4px, transparent 4px, transparent 8px)",
};

const AiUsageBar = ({
  className,
  sharePct,
}: {
  className?: string;
  sharePct: number;
}) => {
  const safeSharePct = Math.max(sharePct, 0);
  const scalePct = Math.max(safeSharePct, 100);
  const shareUsagePct = Math.min(safeSharePct, 100);
  const borrowedUsagePct = Math.max(safeSharePct - 100, 0);
  const shareWidth = Math.min((shareUsagePct / scalePct) * 100, 100);
  const borrowedWidth = Math.min(
    (borrowedUsagePct / scalePct) * 100,
    100 - shareWidth,
  );

  return (
    <div
      aria-label={`${Math.round(safeSharePct)}% of fair share used`}
      className={cn(
        "flex w-full overflow-hidden rounded-full bg-active-modal-element",
        className,
      )}
      role="img"
    >
      {shareWidth > 0 ? (
        <div
          className="h-full shrink-0 bg-hypertasks-purple transition-[width]"
          style={{ width: `${shareWidth}%` }}
        />
      ) : null}
      {borrowedWidth > 0 ? (
        <div
          className="h-full shrink-0 transition-[width]"
          style={{ ...borrowedBarStyle, width: `${borrowedWidth}%` }}
        />
      ) : null}
    </div>
  );
};

export default AiUsageBar;
