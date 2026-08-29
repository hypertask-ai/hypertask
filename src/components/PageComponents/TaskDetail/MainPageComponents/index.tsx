import Tooltip from "@/components/Common/Tooltip";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { IAgent, IUser } from "@/models/model";
import { useContext } from "react";
import { TaskInfoLabel } from "./TaskInfoLabel";
import { cn } from "@/utils/undoActions/helperFuncs";
import UserAvatar from "@/components/Common/UserAvatar";
import { ParentPersonHovercard } from "@/components/Common/PersonHovercard";

export { TaskInfoColumnContainer } from "./TaskInfoColumnContainer";
export { TaskInfoLabel } from "./TaskInfoLabel";
export { TaskInfoValue } from "./TaskInfoValue";

const MOBILE_CHIP_CLASS =
  "inline-flex min-h-[20px] w-fit max-w-full items-center rounded-sm bg-label-span px-1.5 py-0.5 text-meta font-medium leading-none text-white-black";

export const AssigneeCard = ({ user, i, _mbl, projectId }: { user: IUser | IAgent, i: number, _mbl: boolean, projectId?: number }) => {
  const subject = typeof user.id === "number"
    ? { kind: "user" as const, id: user.id }
    : { kind: "agent" as const, id: user.id };
  return (
    <div
      key={i}
      className={cn(
        _mbl
          ? `${MOBILE_CHIP_CLASS} gap-1.5 overflow-hidden`
          // Desktop: no font-size here — the properties rail sets it (14px), and a
          // local override made assignees the only row at 13px (HTPR-5465).
          : "flex items-center space-x-2 font-medium overflow-hidden",
        "max-w-full min-w-0"
      )}
    >
      <ParentPersonHovercard projectId={projectId} subject={subject} />
      <UserAvatar
        alt=""
        name={user.displayName}
        photoURL={user.photoURL}
        size={16}
        title={user.displayName}
      />
      <p className={`truncate min-w-0 ${_mbl ? "max-w-[120px] text-meta" : "max-w-full"}`}>{user?.displayName}</p>
    </div>
  )
}

export const TaskInfoRow: React.FC<{ children: React.ReactNode; alignTop?: boolean }> = ({ children, alignTop = false }) => {
  const _mbl = useContext(MobileViewContext);

  return (
    <div className={cn(
      "flex w-full shrink-0 text-[#8E9093]",
      // Labels top-align with the first line of their value on every row
      // (alignTop kept for call-site compat; it is now the only behavior).
      "items-start",
      _mbl ? "min-h-[24px] gap-2 text-meta" : "min-h-[24px]"
    )}>

      {children}
    </div>

  )
}

export const LocalRightSideInfo = (
  {
    title,
    className,
    onClick,
    left,
    bottom,
    tooltipText,
    KeyCombination,
    showTooltip = true,
  }: {
    title: string,
    className?: string,
    onClick?: () => void,
    left: number,
    bottom: number,
    tooltipText: string,
    KeyCombination: any,
    showTooltip?: boolean
  }) => {
  const _mbl = useContext(MobileViewContext);

  return (
    <>
      <span
        onClick={onClick}
        className={cn(
          "cursor-pointer rounded-[5px] border-icon-dark-gray relative group text-[#8E9093] font-medium",
          _mbl ? "w-[88px] shrink-0 text-meta" : "w-[25%] @sm:w-1/2 @sm:border-none",
          className
        )}>
        {title}
        {showTooltip && <Tooltip
          portal
          left={left}
          bottom={bottom}
          text={tooltipText}
          keyCombination={KeyCombination}
        />}
      </span>
    </>
  )
}

export const ClickableSpan = (
  {
    title,
    className,
  }: {
    title: string,
    className?: string,
  }
) => {
  const _mbl = useContext(MobileViewContext);
  const normalizedTitle = (title ?? "").trim();
  const isEmptyValue =
    normalizedTitle === "" ||
    normalizedTitle === "-" ||
    normalizedTitle.toLowerCase() === "no priority" ||
    normalizedTitle.toLowerCase() === "no tags" ||
    normalizedTitle.toLowerCase() === "no agents";

  return (

    <span
      className={cn(
        "text-text-light-gray",
        _mbl
          ? isEmptyValue
            ? "inline-block max-w-full truncate text-meta text-[#8E9093]"
            : `${MOBILE_CHIP_CLASS} truncate`
          : "inline-block max-w-full truncate cursor-pointer",
        className
      )}
    >
      {title}
    </span>
  )
}

export const RightSideInfoTitle = (
  {
    title,
    className,
    onClick,
  }: {
    title: string,
    className: string,
    onClick: () => void
  }) => {
  return (
    <TaskInfoLabel
      onClick={onClick}
      className={className}
    >
      {title}
    </TaskInfoLabel>

  )
}
