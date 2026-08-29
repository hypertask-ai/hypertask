import TaskLabelComponent from '@/components/Modals/CreateLabel/TaskLabelComponent';
import EstimateLabelComponent from '@/components/Modals/TaskEstimate/EstimateLabelComponent';
import PriorityLabelComponent from '@/components/Modals/TaskPriority/PriorityLabelComponent';
import DueDateLabel from '@/components/Labels/DueDateLabel';
import Tooltip from '@/components/Common/Tooltip';
import { INotification, ITask } from '@/models/model';
import React, { useContext, useRef, useState } from 'react'
// import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useNotificationContext } from '@/lib/contexts/NotificationContext';
import { cn } from '@/utils/undoActions/helperFuncs';
import { inboxConfig, systemDefinedSplits } from '@/lib/configs/inbox.config';
import { formatWaitingOnAge } from '@/lib/waitingOn';

interface ITitleContainer {
    notification?: INotification;
    task: ITask
    className?: string
    hideDueDate?: boolean
}

interface IRenderMessageTag {
    notification: INotification;
    selectedSplit: string;
    isIbxSlctd: boolean;
}

export const TaskMetaChips: React.FC<{ task: ITask; showDueDate?: boolean }> = ({ task, showDueDate }) => {
    const { isIbxSlctd } = useNotificationContext();
    const [now] = useState(() => Date.now());
    const MAX_LABELS = 3;
    const labels = (task.taskLabels ?? []).filter(l => l.label?.value);
    const extra = labels.length - MAX_LABELS;
    const dueDate = showDueDate ? task.dueDate : null;
    const isOverdue = !!dueDate && new Date(dueDate).getTime() < now;
    const chipClassName = cn(
        inboxConfig.bulkSelectionStyling.taskLabels(isIbxSlctd),
        'min-w-0 max-w-[120px] overflow-hidden whitespace-nowrap'
    );

    if (!dueDate && !task.priority && !task.estimate && labels.length === 0) return null;

    // ponytail: chips keep their own width so the preview truncates first; the group
    // is capped so a long label set can never crowd the timestamp.

    return (
        <div className="flex shrink-0 items-center gap-1 overflow-hidden md:max-w-[180px]">
            {dueDate && (
                <DueDateLabel
                    flexBasis={false}
                    fontSize={11}
                    dueDate={dueDate}
                    overdue={isOverdue}
                    className={cn(inboxConfig.bulkSelectionStyling.taskLabels(isIbxSlctd))}
                />
            )}
            {task.priority && (
                <PriorityLabelComponent
                    flexBasis={false}
                    fontSize={11}
                    priority={task.priority}
                    className={chipClassName}
                />
            )}
            {task.estimate && (
                <EstimateLabelComponent
                    flexBasis={false}
                    fontSize={11}
                    estimate={task.estimate}
                    className={chipClassName}
                />
            )}
            {labels.slice(0, MAX_LABELS).map((taskLabel) => (
                <TaskLabelComponent
                    flexBasis={false}
                    key={`task-title-label-${taskLabel.label?.value}`}
                    stopPropogation={false}
                    fontSize={11}
                    labelValue={taskLabel.label?.value ?? ""}
                    className={chipClassName}
                    nowrap
                />
            ))}
            {extra > 0 && (
                <span
                    className={cn(inboxConfig.bulkSelectionStyling.taskLabels(isIbxSlctd), 'opacity-60')}
                    style={{ fontSize: 11 }}
                >
                    +{extra}
                </span>
            )}
        </div>
    )
}

const RenderMessageTag: React.FC<IRenderMessageTag> = ({ notification, selectedSplit, isIbxSlctd }) => {
    const badgeRef = useRef<HTMLSpanElement>(null)
    const [rect, setRect] = useState<DOMRect | null>(null)

    // Early return for system-defined splits
    if (systemDefinedSplits.includes(selectedSplit)) return null

    const { type } = notification

    // "@" marks a personal mention (or being added as a follower); "!" marks an
    // otherwise-important update (comment, assignment, reminder, overdue, ...).
    // Filled square badge so it reads as a status indicator, not a data label.
    let symbol: string | null = null
    let hint = ""
    if (["Mentioned", 'AddedToFollowerInTask'].includes(type)) {
        symbol = "@"
        hint = "You were mentioned"
    } else if (notification.computedSplit === "Important" ||
        (notification.computedSplit === undefined && inboxConfig.importantSplit.includes(type as any))) {
        symbol = "!"
        hint = "Important update"
    }

    if (!symbol) return <></>

    return (
        <span
            ref={badgeRef}
            className="relative group flex shrink-0 items-center"
            onMouseEnter={() => setRect(badgeRef.current?.getBoundingClientRect() ?? null)}
            onMouseLeave={() => setRect(null)}
        >
            <span
                className={cn(
                    "inline-flex h-[18px] w-[18px] items-center justify-center rounded-[4px] text-meta font-semibold leading-none",
                    symbol === "@"
                        ? "bg-mention-highlight text-mention-highlight"
                        : "bg-hover-active text-white-black"
                )}
            >
                {symbol}
            </span>
            {rect && (
                <Tooltip
                    portal
                    anchorRect={rect}
                    text={hint}
                    keyCombination={[]}
                    bottom={0}
                    left={0}
                />
            )}
        </span>
    )
}

const TitleContainer: React.FC<ITitleContainer> = ({ notification, className, task, hideDueDate }) => {

    const { isIbxSlctd, selectedSplit } = useNotificationContext();
    const [now] = useState(() => Date.now());
    const isOverdue = !!task?.dueDate && new Date(task.dueDate).getTime() < now;
    const isBlockedByMe =
        task.waitingOnUserId != null &&
        task.waitingOnUserId === notification?.userId;
    const flipMentionHierarchy = notification?.type === "Mentioned" && Boolean(notification.commentId) && Boolean(notification.task);

    // md:min-w keeps the title readable: the preview yields space before it does.
    const defaultClassName = "truncate flex-1 flex-column sm:flex-initial md:min-w-[180px]"

    return (
        <div
            suppressHydrationWarning
            className={className ? className : defaultClassName}
        >
            <span
                className="flex items-center truncate justify-start gap-1 xs:flex-wrap md:flex-nowrap"
                style={{
                    fontSize: 13 }}
            >
                {
                    notification && <RenderMessageTag isIbxSlctd={isIbxSlctd} notification={notification} selectedSplit={selectedSplit} />
                }

                {/* ================== duedate label ============== */}
                {!hideDueDate && task?.dueDate && (
                    <DueDateLabel
                        flexBasis={false}
                        fontSize={11}
                        // fontWeight={500}
                        dueDate={task.dueDate}
                        overdue={isOverdue}
                        className={cn(inboxConfig.bulkSelectionStyling.taskLabels(isIbxSlctd))}

                    />
                )}
                <div

                    className={`xs:inline sm:flex sm:items-baseline gap-1 `}>
                    {isBlockedByMe && (
                        <span
                            className="inline-flex shrink-0 items-center rounded-[4px] bg-[hsl(0_62.8%_30.6%)] px-1.5 py-0.5 text-micro font-semibold leading-none text-white"
                        >
                            ⛔ BLOCKED · {formatWaitingOnAge(task.waitingOnSetAt, now)}
                        </span>
                    )}
                    <span
                        className={cn(inboxConfig.bulkSelectionStyling.ticketNumber(isIbxSlctd), '')}
                        style={{ fontSize: 11 }}
                    >
                        {
                            task?.ticketNumber ? task.ticketNumber + " " : ""
                        }
                    </span>
                    <span
                        // 
                        className={cn(
                            inboxConfig.bulkSelectionStyling.taskTitle(isIbxSlctd),
                            'xs:whitespace-pre-wrap sm:whitespace-nowrap',
                            flipMentionHierarchy && !isIbxSlctd && 'font-normal text-[#8E9093]'
                        )}>
                        {
                            task.title ?? ""
                        }
                    </span>
                </div>
            </span>
        </div>
    )
}

export default TitleContainer
