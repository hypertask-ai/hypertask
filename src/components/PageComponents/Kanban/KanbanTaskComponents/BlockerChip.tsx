import UserAvatar from '@/components/Common/UserAvatar';
import useHypertasksNavigate from '@/hooks/MultiPages/Route/useHypertasksNavigate';
import type { IBlockingTask } from '@/models/model';

export type BlockerUser = {
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
};

const blockerChipClassName = "inline-flex h-labelComponent max-w-full items-center gap-1 rounded-[4px] bg-[hsl(0_62.8%_30.6%)] px-1.5 text-micro font-semibold leading-none text-white";

const BlockerChip = ({ user }: { user: BlockerUser }) => {
  const name = user.displayName?.trim() || user.email?.trim() || "Unknown person";
  return (
    <span className={blockerChipClassName}>
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
  const ticketNumber = task.ticketNumber || `#${task.uniqueIndex}`;
  const label = `${ticketNumber} ${task.title}`;

  return (
    <span
      aria-label={`Open blocker ${label}`}
      className={`${blockerChipClassName} cursor-pointer`}
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
