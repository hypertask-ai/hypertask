import { INotification, TRemoveFromInboxMode } from "@/models/model";
import formatDateDifference from "@/utils/generateTime";
import { Circle } from "lucide-react";
import UserAvatar from "../Common/UserAvatar";

import { convertToPlain } from "@/utils/helperFunctions/helperFunctions";
import { ArchiveNotificationIcon } from "@/lib/IconsLocal";
import Tooltip from "../Common/Tooltip";
import { useNotificationContext } from "@/lib/contexts/NotificationContext";
import React, { useMemo } from "react";
import TaskRowContainer from "../Common/TaskRowComponents/TaskRowContainer";
import TitleContainer, { TaskMetaChips } from "../Common/TaskRowComponents/TaskTitle";
import RemindMeInbox from "./inboxSplit/RemindMeInbox";
import { format } from "date-fns";
import { cn } from "@/utils/undoActions/helperFuncs";
import { inboxConfig } from "@/lib/configs/inbox.config";
import { inboxArchiveTooltip } from "@/lib/inboxClusters";
import { INBOX_ARCHIVE_CLUSTER_FLAG } from "@/lib/flags";
import { useFlag } from "@/hooks/useFlag";
import { decodeAgentMessage } from "@/lib/nativeAgent/agentMessageEnvelope";

interface Props {
    markAsDone: (notification: INotification, index: number, mode: TRemoveFromInboxMode) => Promise<void>,
    openTask: (mode: string, notification?: INotification | null, index?: number) => Promise<void>,
    // setSelectedInbox: Dispatch<SetStateAction<INotification | null>>,
    handleMouseLeave: () => void,
    handleMouseEnter: (index: number) => void,
    selected: boolean,
    taskRef: React.RefObject<HTMLDivElement | null>,
    index: number,
    eHandler: (mode: boolean, specificIndex?: number) => void,
    disableButtons?: boolean,
    appShellRail?: boolean,

}

const NotificationRow = (props: Props) => {
    const { handleMouseEnter, selected, handleMouseLeave, openTask, taskRef, index, eHandler, disableButtons = false, appShellRail = false } = props
    const { notification, isIbxSlctd, selectedIds } = useNotificationContext();
    const clusterArchiveEnabled = useFlag(INBOX_ARCHIVE_CLUSTER_FLAG);
    const flipMentionHierarchy = notification.type === "Mentioned" && Boolean(notification.commentId) && Boolean(notification.task);

    const handleClick = () => {
        openTask("view", notification)
    }

    return (
        <TaskRowContainer
            index={index}
            selected={selected}
            divId={notification.id}
            taskRef={taskRef}
            divType="inbox"
            handleMouseEnter={handleMouseEnter}
            handleMouseLeave={handleMouseLeave}
            openTask={handleClick}
            className={`relative flex cursor-pointer  md:space-x-8  py-[8px]   px-[20px] md:px-0 rounded-md
                justify-between w-full flex-col md:flex-row`}
        >

            <div className='flex md:space-x-6 md:w-[15%] md:min-w-[15%] md:max-w-[15%] md:shrink-0'>

                <div className='flex justify-between w-100 md:min-w-0'>
                    <NotificationUserName />
                    <CreatedAtMobile />
                </div>
            </div>

            <div className="flex flex-grow xs:mt-2 sm:mt-0 gap-2 items-baseline md:items-center md:w-[40%] md:min-w-0 md:overflow-hidden flex-col md:flex-row">

                {/* ============ notification content =========== */}
                {flipMentionHierarchy && <NotificationContent />}

                {/* ============ title =================  */}
                {notification.type !== "Invited" && notification.task && <TitleContainer notification={notification} task={notification.task} className={flipMentionHierarchy ? "md:flex-1 md:basis-0 md:min-w-0 truncate" : undefined} hideDueDate={flipMentionHierarchy} />}

                {!flipMentionHierarchy && <NotificationContent />}

                {notification.type !== "Invited" && notification.task && <TaskMetaChips task={notification.task} showDueDate={flipMentionHierarchy} />}
            </div>

            <CreatedAtDesktop hidden={!disableButtons && selected} />
            {/* Superhuman-style overlay (HTPR-4954 v2, reserved-gutter approach
                banned): absolutely positioned, so mounting/unmounting on hover
                never affects the flow siblings (timestamp, content) beside it.
                bg-active-elementBg matches the row's own selected/hover
                background (inboxSplit/index.tsx md:bg-active-elementBg) so it
                opaquely suppresses the timestamp underneath instead of blending. */}
            {!disableButtons && selected && <div className={`${selectedIds && selectedIds?.length > 0 ? "!invisible" : ""} absolute right-0 top-1/2 z-10 hidden -translate-y-1/2 items-center gap-[10px] bg-active-elementBg pl-3 pr-1 md:flex`}>
                <button
                    className="relative group"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation(); // Prevent the click event from propagating to the parent div
                        eHandler(false, index);
                    }}
                >
                    <Tooltip
                        left={-195}
                        bottom={-40}
                        text={inboxArchiveTooltip(clusterArchiveEnabled ? notification.clusterCount : undefined)}
                        keyCombination={["E"]}
                    />
                    <ArchiveNotificationIcon color={inboxConfig.bulkSelectionStyling.archive_reminder_icon(isIbxSlctd)} height={18} width={18} show={selected} />

                    {/* <Check size={15} color={notification.type==="Assigned"? (notification.assignee?.task?.status === 'Archive' ? 'green' : '#8E9093'): (notification.comment?.task?.status === 'Archive' ? 'green' : '#8E9093')} strokeWidth={1.75} /> */}
                </button>
                <RemindMeInbox color={inboxConfig.bulkSelectionStyling.archive_reminder_icon(isIbxSlctd)} height={18} width={18} show={selected} />
            </div>}
        </TaskRowContainer>

    )
}

const CreatedAtDesktop = ({ hidden = false }: { hidden?: boolean }) => {
    const { notification, isIbxSlctd } = useNotificationContext();
    // HTPR-4955: the bracket beside the sender now carries the unread count,
    // so repeating it as a "· N unread" suffix here is noise.

    return (
        <>

            <span
                className={cn(
                    inboxConfig.bulkSelectionStyling.timestamp(isIbxSlctd),
                    "hidden md:block md:min-w-[57px] md:shrink-0",
                    // visibility (not display) keeps the space, so nothing reflows
                    hidden && "md:invisible"
                )}
                suppressHydrationWarning
                style={{
                    fontSize: 13 }}
            >
                {formatDateDifference(notification.createdAt)}
            </span>
        </>
    )
}

const CreatedAtMobile = () => {
    const { notification, isIbxSlctd } = useNotificationContext();
    // HTPR-4955: the bracket beside the sender now carries the unread count,
    // so repeating it as a "· N unread" suffix here is noise.
    return (
        <div
            className={
                cn(
                    inboxConfig.bulkSelectionStyling.timestamp(isIbxSlctd),
                    "flex items-center md:hidden font-semibold"
                )}>
            <span
                suppressHydrationWarning
                style={{
                    fontSize: 13 }}
            >
                {formatDateDifference(notification.createdAt)}
            </span>
        </div>
    )
}

function extractMentionSnippet(html: string, userId: string): string | null {
    if (!html || !userId) return null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Match spans where data-label ends with userId (e.g. "name-123")
    const mentions = Array.from(doc.querySelectorAll('span[data-type="mention"]'));
    const mention = mentions.find(el => {
        const label = el.getAttribute('data-label');
        return label?.toLowerCase() === `name-${userId.toLowerCase()}`;
    });

    if (!mention) return null;

    // Get full sentence or paragraph around the mention
    const parent = mention.closest('p') || mention.parentElement;
    const fullText = parent?.textContent?.trim();
    if (!fullText) return null;

    // Extract preview snippet around the mention text
    const mentionText = mention.textContent ?? '';
    const index = fullText.indexOf(mentionText);
    const snippet = fullText.slice(Math.max(0, index - 40), index + mentionText.length + 40);

    return `${fullText}...`;
}

export const NotificationContent = () => {
    const { notification, isIbxSlctd } = useNotificationContext();
    const flipMentionHierarchy = notification.type === "Mentioned" && Boolean(notification.commentId) && Boolean(notification.task);
    const dueDate = notification.task?.dueDate ? new Date(notification.task.dueDate) : null;
    const formattedDueDate = dueDate
        ? format(dueDate, dueDate.getFullYear() === new Date().getFullYear() ? "dd MMM" : "dd MMM yyyy")
        : null;

    return (
        <div
            suppressHydrationWarning
            className={cn(
                inboxConfig.bulkSelectionStyling.content(isIbxSlctd),
                flipMentionHierarchy
                    ? "truncate flex-column md:flex-1 md:basis-0 md:min-w-0"
                    : "flex-1 truncate flex-column md:min-w-[90px]",
                flipMentionHierarchy && !isIbxSlctd && "font-medium text-white-black"
            )}
        >
            <span
                suppressHydrationWarning
                className="truncate line-clamp-1 xs:max-w-[92vw] md:max-w-full xs:whitespace-pre-wrap md:whitespace-nowrap"
                style={{
                    fontSize: 13 }}
            >
                {typeof window !== "undefined" &&
                    notification.type === "Comment"
                    ? renderCommentPreview(notification.comment?.text ?? "")
                    : notification.type === "Assigned"
                        ? "Assigned to you"
                        : notification.type === "TaskArchived"
                            ? notification.task.status === "Archive" ? "Archived this task" : "Unarchived this task"
                            : notification.type === "TaskMoved"
                                ? `Moved to ${notification.task.section}`
                                : notification.type === "AddedToFollowerInTask"
                                    ? `Added you to followers and mentioned you`
                                    : notification.type === "Mentioned"
                                        ? notification.commentId ?
                                            flipMentionHierarchy
                                                ? renderCommentMentionSimple(notification.comment?.text ?? "", notification.userId)
                                                : <>

                                                    Mentioned in:&nbsp;
                                                    {renderCommentMentionSimple(notification.comment?.text ?? "", notification.userId)}
                                                </>
                                            :
                                            `Mentioned in`
                                        : notification.type === "Invited"
                                            ? `Click or press ENTER to accept invitation`
                                        : notification.type === "TaskDueDate" ?
                                                formattedDueDate ?
                                                    `Due date changed to ${formattedDueDate}` : "Due date reset"
                                                // ? `Click or press ENTER to accept invitation` 
                                                : notification.type === "TaskReminder"
                                                    ? notification.staleNudgeDays === undefined
                                                        ? "Task Reminder"
                                                        : `No activity for ${notification.staleNudgeDays} days`
                                                    : notification.type === "TaskMovedToInbox"
                                                        ? "Task moved to inbox"
                                                        : notification.type === "TaskOverdue"
                                                            // HTPR-4378: the due-date chip already renders in the
                                                            // overdue red, so the phrase repeated the signal on
                                                            // nearly every row.
                                                            ? ""
                                                            : notification.type === "TaskUpdateDescription"
                                                                ? "Description updated"
                                                                : notification.type === "AgentMessage"
                                                                    ? convertToPlain(decodeAgentMessage(notification.message))
                                                                    : notification.type === "Reacted" && !notification.commentId
                                                                    ? `Reacted with ${notification.reaction?.emoji
                                                                    } on description`
                                                                    : `Reacted with ${notification.reaction?.emoji
                                                                    } on ${convertToPlain(
                                                                        notification.comment?.text ?? ""
                                                                    )} `

                }

            </span>
        </div>
    )
}

const NotificationUserName = () => {
    const { notification, isIbxSlctd, displayAvatar } = useNotificationContext();

    const recentActors = notification.recentActors ?? [];
    const showRecentActors = recentActors.length >= 2;
    const displayName =
        notification?.fromAgent?.displayName ?? notification?.fromUser?.displayName ?? "";
    const photoURL =
        notification?.fromAgent?.photoURL ?? notification?.fromUser?.photoURL ?? "";
    const userName = showRecentActors
        ? recentActors.map((actor) => actor.displayName).join(", ")
        : displayName;

    return (
        <div className="gap-1 flex items-center md:min-w-0" style={{ fontSize: 13 }}>
            <span className="flex gap-1 md:gap-1 items-center md:min-w-0">

                {hasInboxStatusIndicator(notification) && (
                    <Seen notification={notification} className="md:hidden" />
                )}

                {showRecentActors && displayAvatar === "Show" ? (
                    <span className="flex items-center md:order-2">
                        {recentActors.map((actor, actorIndex) => (
                            <UserAvatar
                                key={`${actor.displayName}-${actorIndex}`}
                                alt={actor.displayName}
                                className={cn(
                                    actorIndex > 0 && "-ml-2"
                                )}
                                name={actor.displayName}
                                photoURL={actor.photoURL}
                                size={20}
                                title={actor.displayName}
                            />
                        ))}
                    </span>
                ) : displayAvatar === "Show" ? (
                    <UserAvatar
                        agentId={notification?.fromAgent?.id}
                        alt={displayName}
                        className="md:order-2"
                        name={displayName}
                        photoURL={photoURL}
                        size={20}
                        title={displayName}
                    />
                ) : null}

                <span className={cn(inboxConfig.bulkSelectionStyling.username(isIbxSlctd), "md:order-1 md:min-w-0 md:truncate")}>
                    {userName}
                </span>
            </span>
            {
                // HTPR-4955: an inbox scans for what is unread, so the bracket
                // carries the unread count, not the ticket's total comments.
                notification.type !== "Invited" && notification.unreadCount && notification.unreadCount > 0 ?

                    <span className={cn(inboxConfig.bulkSelectionStyling.commentCount(isIbxSlctd), " mx-1 shrink-0")}>
                        ({notification.unreadCount})
                    </span>

                    :
                    <></>
            }
        </div>
    )
}

export const hasInboxStatusIndicator = (notification: INotification) => {
    const hasSavedContent = Boolean(notification.task?.savedContent?.length);
    const isBlockedByMe =
        notification.task?.waitingOnUserId != null &&
        notification.task.waitingOnUserId === notification.userId;

    return hasSavedContent || isBlockedByMe || !notification.seen;
}

export const Seen = ({ notification, className }: { notification: any; className?: string }) => {
    const isBlockedByMe =
        notification.task?.waitingOnUserId != null &&
        notification.task.waitingOnUserId === notification.userId;
    const notificationColor = useMemo(() => {
        if (notification.returnedFromReminders) return "text-hypertasks-green"
        else if (notification.type === "TaskOverdue") return `text-[#F88F9C]`
        else return "text-[#5896F1]"
    }, [notification])
    return (
        <div className={cn("group relative left-0 flex w-[10px] items-center justify-center", className)}>
            {notification.task?.savedContent && notification.task?.savedContent?.length > 0 ? (
                <Circle size={7} className="fill-current text-[#FFCB33] w-new-notification relative z-10" strokeWidth={1.75} fill="currentColor" />
            ) : (
                <></>
            )}
            {isBlockedByMe ? (
                <Circle
                    size={7}
                    className="fill-current w-new-notification relative -ml-[3px] z-0"
                    strokeWidth={1.75}
                    fill="currentColor"
                    style={{ color: "hsl(0 62.8% 30.6%)" }}
                />
            ) : !notification.seen ?
                <>
                    <Circle size={7} className={`fill-current ${notificationColor} w-new-notification relative -ml-[3px] z-0`} strokeWidth={1.75} fill="currentColor" />
                    {
                        notification.returnedFromReminders
                        &&
                        <Tooltip
                            left={13}
                            bottom={-11}
                            text="Returned from a Reminder"
                            keyCombination={[]}
                        />
                    }
                </>
                :
                <></>}
        </div>
    )
}

export default NotificationRow

function stripQuotedContent(root: HTMLElement): void {
    root.querySelectorAll("blockquote").forEach(blockquote => blockquote.remove());
    root.querySelectorAll("p").forEach(paragraph => {
        const mentions = paragraph.querySelectorAll('span[data-type="mention"]');
        const mention = mentions[0];
        if (!mention || mentions.length !== 1 || paragraph.children.length !== 1 || paragraph.firstElementChild !== mention) return;

        const mentionText = mention.textContent?.trim() ?? "";
        const paragraphText = paragraph.textContent?.trim().replace(/:$/, "").trim() ?? "";
        if (mentionText && paragraphText === `${mentionText} said`) paragraph.remove();
    });
}

function renderCommentPreview(html: string) {
    const div = document.createElement("div");
    div.innerHTML = html;
    stripQuotedContent(div);
    return div.textContent?.trim() || convertToPlain(html);
}

export function renderCommentMentionSimple(html: string, currentUserId: string | number) {
    // Extract the inner text (plain) from your HTML.
    // Assumes structure: <p><span ...mention...>Username</span> Rest of message</p>
    // We'll use regex to extract.
  
    const div = document.createElement("div");
    div.innerHTML = html;
    const fullText = div.textContent || '';
    stripQuotedContent(div);
    const mentionSpan = div.querySelector(`span[data-type="mention"][data-label="name-${currentUserId}"]`);
    let mentionText = '';
    if (mentionSpan) {
        mentionText = mentionSpan.textContent || '';
        // highlight only the mention, and show the rest of the text normally
        const parentText = mentionSpan.parentElement?.textContent || '';
        // Split around the mention and render
        const before = parentText.slice(0, parentText.indexOf(mentionText));
        const after = parentText.slice(parentText.indexOf(mentionText) + mentionText.length);
        return (
            <>
                {before}
                    <span
                        className="bg-mention-highlight text-mention-highlight" 
                        style={{ borderRadius: "4px", padding: "2px 4px" }}>@{mentionText}</span>
                {after}
            </>
        );
    }
    // If there is no mention, just return the text
    return div.textContent?.trim() || fullText;
  }
