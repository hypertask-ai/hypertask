import UserAvatar from '@/components/Common/UserAvatar';
import useHypertasksNavigate from '@/hooks/MultiPages/Route/useHypertasksNavigate';
import { useFlag } from '@/hooks/useFlag';
import { HTPR_8927_BOARD_CARD_OVERFLOW_FLAG } from '@/lib/flags/definitions/htpr-8927-board-card-overflow';
import type { IBlockingTask } from '@/models/model';
import { cn } from '@/utils/undoActions/helperFuncs';

export type BlockerUser = {
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
};

const blockerChipClassName =
  "inline-flex h-labelComponent max-w-full items-center gap-1 rounded-[4px] bg-[hsl(0_62.8%_30.6%)] px-1.5 text-micro font-semibold leading-none text-white";

const BlockerChip = ({ user }: { user: BlockerUser }) => {
  const cardOverflowClamp = useFlag(HTPR_8927_BOARD_CARD_OVERFLOW_FLAG);
  const name = user.displayName?.trim() || user.email?.trim() || "Unknown person";
  return (
    <span className={cn(blockerChipClassName, cardOverflowClamp && "min-w-0 overflow-hidden")}>
      <UserAvatar
        alt=""
        fallbackClassName="bg-white/20 text-white"
        name={name}
        photoURL={user.photoURL}
        size={16}
        title={name}
      />
      <span className="truncate">{name}</span>
    </span>
  );
};

export const BlockerTaskChip = ({ task }: { task: IBlockingTask }) => {
  const { navigateToTask } = useHypertasksNavigate();
  const cardOverflowClamp = useFlag(HTPR_8927_BOARD_CARD_OVERFLOW_FLAG);
  const ticketNumber = task.ticketNumber || `#${task.uniqueIndex}`;
  const label = `${ticketNumber} ${task.title}`;

  return (
    <span
      aria-label={`Open blocker ${label}`}
      className={cn(
        blockerChipClassName,
        "cursor-pointer",
        cardOverflowClamp && "min-w-0 overflow-hidden",
      )}
      data-blocking-task={task.id}
      role="link"
      tabIndex={0}
      title={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        navigateToTask(task.projectId, task.uniqueIndex);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        navigateToTask(task.projectId, task.uniqueIndex);
      }}
    >
      <span className="shrink-0">{ticketNumber}</span>
      <span className="truncate">{task.title}</span>
    </span>
  );
};

export default BlockerChip;
