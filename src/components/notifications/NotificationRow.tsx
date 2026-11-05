import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { INBOX_QUERY_KEY } from "@/lib/inboxQueryKeys";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7582_AGENT_ACCESS_REQUEST_FLAG } from "@/lib/flags/definitions/htpr-7582-agent-access-request";
import type { BoardAccessReceipt } from "@/lib/agents/boardAccessRequests/contracts";
import { INotification, TRemoveFromInboxMode } from "@/models/model";
import formatDateDifference from "@/utils/generateTime";
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";
import { projectDisplayDate } from "@/lib/firstScreen/display";
import dynamic from "next/dynamic";
import type * as CommentProjection from "@/lib/firstScreen/comment";
const SeededNotificationContent = dynamic(() => import("./SeededNotificationContent"));
import { Circle } from "lucide-react";
import UserAvatar from "../Common/UserAvatar";

import { convertToPlain } from "@/utils/helperFunctions/helperFunctions";
import { ArchiveNotificationIcon } from "@/lib/IconsLocal";
import Tooltip from "../Common/Tooltip";
import { useNotificationContext } from "@/lib/contexts/NotificationContext";
import { HTPR_8264_INBOX_ROW_FILL_FLAG } from "@/lib/flags/definitions/htpr-8264-inbox-row-fill";
import { HTPR_8264_INBOX_NAME_COLUMN_FLAG } from "@/lib/flags/definitions/htpr-8264-inbox-name-column";
import { buildInboxRowFillParts, clipInboxPreview, type InboxRowFillPartKind } from "@/lib/inbox/inboxRowFill";
import React, { useEffect, useMemo, useRef, useState } from "react";
import TaskRowContainer from "../Common/TaskRowComponents/TaskRowContainer";
import TitleContainer, { TaskMetaChips } from "../Common/TaskRowComponents/TaskTitle";
import RemindMeInbox from "./inboxSplit/RemindMeInbox";
import { format } from "date-fns";
import { cn } from "@/utils/undoActions/helperFuncs";
import { inboxConfig } from "@/lib/configs/inbox.config";
import { decodeAgentMessage } from "@/lib/nativeAgent/agentMessageEnvelope";

interface Props {
    markAsDone: (notification: INotification, index: number, mode: TRemoveFromInboxMode) => Promise<boolean | void>,
    openTask: (mode: string, notification?: INotification | null, index?: number) => Promise<void>,
    handleMouseLeave: () => void,
    handleMouseEnter: (index: number) => void,
    selected: boolean,
    taskRef: React.RefObject<HTMLDivElement | null>,
    index: number,
    eHandler: (mode: boolean, specificIndex: number | undefined, source: "keyboard" | "mouse" | "swipe") => void,
    disableButtons?: boolean,
    appShellRail?: boolean,

}

const NotificationRow = (props: Props) => {
    const { handleMouseEnter, selected, handleMouseLeave, openTask, taskRef, index, eHandler, disableButtons = false, appShellRail = false } = props
    const { notification, isIbxSlctd, selectedIds } = useNotificationContext();
    const inboxRowFill = useFlag(HTPR_8264_INBOX_ROW_FILL_FLAG);
    const inboxNameColumn = useFlag(HTPR_8264_INBOX_NAME_COLUMN_FLAG);
    const flipMentionHierarchy = !inboxRowFill && notification.type === "Mentioned" && Boolean(notification.commentId) && Boolean(notification.task);

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
            className={`relative flex cursor-pointer  ${inboxRowFill ? "md:space-x-4" : "md:space-x-8"}  py-[8px]   px-[20px] md:px-0 ${inboxRowFill ? "rounded-[4px]" : "rounded-md"}
                justify-between w-full flex-col md:flex-row`}
        >

            <div className={cn('flex md:space-x-6', inboxRowFill && inboxNameColumn ? 'md:w-[180px] md:min-w-[180px] md:max-w-[180px] md:shrink-0' : inboxRowFill ? 'md:shrink-0 md:min-w-0 md:max-w-[180px]' : 'md:w-[15%] md:min-w-[15%] md:max-w-[15%] md:shrink-0')}>

                <div className='flex justify-between w-100 md:min-w-0'>
                    <NotificationUserName />
                    <CreatedAtMobile />
                </div>
            </div>

            <div className={cn("flex flex-grow xs:mt-2 sm:mt-0 gap-2 items-baseline md:items-center md:min-w-0 md:overflow-hidden flex-col md:flex-row", inboxRowFill ? "md:flex-1" : "md:w-[40%]")}>

                {flipMentionHierarchy && <NotificationContent />}

                {notification.type !== "Invited" && notification.task && <TitleContainer notification={notification} task={notification.task} className={flipMentionHierarchy ? "md:flex-1 md:basis-0 md:min-w-0 truncate" : undefined} hideDueDate={flipMentionHierarchy} />}

                {!flipMentionHierarchy && <NotificationContent />}

                {notification.type !== "Invited" && notification.task && <TaskMetaChips task={notification.task} showDueDate={flipMentionHierarchy} />}
            </div>

            <div className="relative hidden md:block md:min-w-[62px] md:shrink-0">
                <CreatedAtDesktop hidden={!disableButtons && selected} />
                {!disableButtons && selected && <div className={`${selectedIds && selectedIds?.length > 0 ? "!invisible" : ""} absolute right-0 top-1/2 z-10 hidden -translate-y-1/2 items-center gap-[10px] bg-active-elementBg pl-3 pr-1 md:flex`}>
                    <button
                        className="relative group"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            eHandler(false, index, e.detail === 0 ? "keyboard" : "mouse");
                        }}
                    >
                        <Tooltip
                            left={-195}
                            bottom={-40}
                            text="Archive"
                            keyCombination={["E"]}
                        />
                        <ArchiveNotificationIcon color={inboxConfig.bulkSelectionStyling.archive_reminder_icon(isIbxSlctd)} height={18} width={18} show={selected} />

                    </button>
                    <RemindMeInbox color={inboxConfig.bulkSelectionStyling.archive_reminder_icon(isIbxSlctd)} height={18} width={18} show={selected} />
                </div>}
            </div>
        </TaskRowContainer>

    )
}

const CreatedAtDesktop = ({ hidden = false }: { hidden?: boolean }) => {
    const { notification, isIbxSlctd } = useNotificationContext();
    const snapshot = useFirstScreenSurface(notification.userId);

    return (
        <>

            <span
                className={cn(
                    inboxConfig.bulkSelectionStyling.timestamp(isIbxSlctd),
                    "hidden md:block md:min-w-[57px] md:shrink-0",
                    hidden && "md:invisible"
                )}
                suppressHydrationWarning={!snapshot}
                style={{
                    fontSize: 13 }}
            >
                {snapshot ? projectDisplayDate(notification.createdAt, snapshot) : formatDateDifference(notification.createdAt)}
            </span>
        </>
    )
}

const CreatedAtMobile = () => {
    const { notification, isIbxSlctd } = useNotificationContext();
    const snapshot = useFirstScreenSurface(notification.userId);
    return (
        <div
            className={
                cn(
                    inboxConfig.bulkSelectionStyling.timestamp(isIbxSlctd),
                    "flex items-center md:hidden font-semibold"
                )}>
            <span
                suppressHydrationWarning={!snapshot}
                style={{
                    fontSize: 13 }}
            >
                {snapshot ? projectDisplayDate(notification.createdAt, snapshot) : formatDateDifference(notification.createdAt)}
            </span>
        </div>
    )
}

function extractMentionSnippet(html: string, userId: string): string | null {
    if (!html || !userId) return null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const mentions = Array.from(doc.querySelectorAll('span[data-type="mention"]'));
    const mention = mentions.find(el => {
        const label = el.getAttribute('data-label');
        return label?.toLowerCase() === `name-${userId.toLowerCase()}`;
    });

    if (!mention) return null;

    const parent = mention.closest('p') || mention.parentElement;
    const fullText = parent?.textContent?.trim();
    if (!fullText) return null;

    const mentionText = mention.textContent ?? '';
    const index = fullText.indexOf(mentionText);
    const snippet = fullText.slice(Math.max(0, index - 40), index + mentionText.length + 40);

    return `${fullText}...`;
}

export const NotificationContent = () => {
    const { notification } = useNotificationContext();
    const snapshot = useFirstScreenSurface(notification.userId);
    return snapshot ? <SeededNotificationContent /> : <NotificationContentBody />;
}

type PlainText = (html: string) => string | undefined;

type NotificationReasonContext = {
    notification: INotification;
    projection?: typeof CommentProjection;
    plain: PlainText;
    formattedDueDate: string | null;
    flipMentionHierarchy: boolean;
};

function notificationReason({ notification, projection, plain, formattedDueDate, flipMentionHierarchy }: NotificationReasonContext): React.ReactNode {
    const canRenderHtml = Boolean(projection) || typeof window !== "undefined";
    if (!canRenderHtml && (notification.type === "Comment" || notification.type === "Mentioned")) return "";
    if (notification.type === "Comment") {
        return projection ? projection.projectCommentPreview(notification.comment?.text ?? "").text : renderCommentPreview(notification.comment?.text ?? "");
    }
    if (notification.type === "Assigned") return "Assigned to you";
    if (notification.type === "TaskArchived") return notification.task.status === "Archive" ? "Archived this task" : "Unarchived this task";
    if (notification.type === "TaskMoved") return `Moved to ${notification.task.section}`;
    if (notification.type === "AddedToFollowerInTask") return "Added you to followers and mentioned you";
    if (notification.type === "Mentioned") {
        if (!notification.commentId) return "Mentioned in";
        const mention = renderCommentMentionSimple(notification.comment?.text ?? "", notification.userId, projection);
        return flipMentionHierarchy ? mention : <>Mentioned in:&nbsp;{mention}</>;
    }
    if (notification.type === "Invited") return "Click or press ENTER to accept invitation";
    if (notification.type === "TaskDueDate") return formattedDueDate ? `Due date changed to ${formattedDueDate}` : "Due date reset";
    if (notification.type === "TaskReminder") return notification.staleNudgeDays === undefined ? "Task Reminder" : `No activity for ${notification.staleNudgeDays} days`;
    if (notification.type === "TaskMovedToInbox") return "Task moved to inbox";
    if (notification.type === "TaskOverdue") return "";
    if (notification.type === "TaskUpdateDescription") return "Description updated";
    if (notification.type === "AgentMessage") return plain(decodeAgentMessage(notification.message)) ?? "";
    if (notification.type === "Reacted" && !notification.commentId) return `Reacted with ${notification.reaction?.emoji} on description`;
    return `Reacted with ${notification.reaction?.emoji} on ${plain(notification.comment?.text ?? "") ?? ""} `;
}

function notificationReasonText(context: NotificationReasonContext): string {
    const reason = notificationReason({ ...context, flipMentionHierarchy: false });
    return typeof reason === "string" ? reason.trim() : "";
}

type InboxRowFillDecor = { kind: InboxRowFillPartKind; node: React.ReactNode };

function inboxRowFillDecor({
    notification,
    projection,
    plain,
    formattedDueDate,
    highlightComment,
}: {
    notification: INotification;
    projection?: typeof CommentProjection;
    plain: PlainText;
    formattedDueDate: string | null;
    highlightComment: boolean;
}): InboxRowFillDecor[] {
    const toPlain = (html: string) => plain(html.slice(0, 1200)) ?? "";
    const commentText = notification.comment?.text ?? "";
    const commentLeads = Boolean(notification.commentId) && commentText.length > 0 &&
        (notification.type === "Comment" || notification.type === "Mentioned" || notification.type === "AddedToFollowerInTask");
    const latestHumanComment = notification.task?.comments?.[0];
    const latestCommentText = toPlain(latestHumanComment?.text ?? "");
    const parts = buildInboxRowFillParts({
        commentText: commentLeads ? toPlain(commentText) : "",
        commentAuthor: notification.fromUser?.displayName ?? notification.fromAgent?.displayName ?? "",
        commentId: commentLeads ? notification.commentId ?? null : null,
        latestCommentText: latestCommentText === toPlain(commentText) ? "" : latestCommentText,
        latestCommentAuthor: latestHumanComment?.creator?.displayName ?? "",
        descriptionText: toPlain(notification.task?.description_?.content ?? ""),
        title: notification.task?.title ?? "",
        reason: notificationReasonText({ notification, projection, plain, formattedDueDate, flipMentionHierarchy: false }),
        reasonShowsText: commentText.length > 0 || notification.type === "AgentMessage",
    });

    return parts.map((part) => {
        if (highlightComment && commentLeads && part.kind === "comment" && part.text === toPlain(commentText)) {
            const body = notification.type === "Comment"
                ? projection ? projection.projectCommentPreview(commentText).text : renderCommentPreview(commentText)
                : renderCommentMentionSimple(commentText, notification.userId, projection);
            return { kind: part.kind, node: part.author ? <>{part.author}: {body}</> : body };
        }
        const text = part.author ? `${part.author}: ${clipInboxPreview(part.text)}` : clipInboxPreview(part.text);
        return { kind: part.kind, node: text };
    });
}

const RowFillParts = ({ projection }: { projection?: typeof CommentProjection }) => {
    const { notification } = useNotificationContext();
    const snapshot = useFirstScreenSurface(notification.userId);
    const plain = snapshot && projection ? projection.projectPlainText : convertToPlain;
    const dueDate = notification.task?.dueDate ? new Date(notification.task.dueDate) : null;
    const formattedDueDate = dueDate
        ? snapshot ? projectDisplayDate(dueDate, snapshot, "changed") : format(dueDate, dueDate.getFullYear() === new Date().getFullYear() ? "dd MMM" : "dd MMM yyyy")
        : null;
    const parts = inboxRowFillDecor({
        notification,
        projection,
        plain,
        formattedDueDate,
        highlightComment: Boolean(projection) || typeof window !== "undefined",
    });

    return (
        <>
            {parts.map((part, partIndex) => (
                <React.Fragment key={partIndex}>
                    {partIndex > 0 && <span className="opacity-60">{" \u00b7 "}</span>}
                    {part.node}
                </React.Fragment>
            ))}
        </>
    );
}

export const NotificationContentBody = ({ projection }: { projection?: typeof CommentProjection }) => {
    const { notification, isIbxSlctd } = useNotificationContext();
    const snapshot = useFirstScreenSurface(notification.userId);
    const rowFill = useFlag(HTPR_8264_INBOX_ROW_FILL_FLAG);
    const plain = snapshot && projection ? projection.projectPlainText : convertToPlain;
    const flipMentionHierarchy = !rowFill && notification.type === "Mentioned" && Boolean(notification.commentId) && Boolean(notification.task);
    const dueDate = notification.task?.dueDate ? new Date(notification.task.dueDate) : null;
    const formattedDueDate = dueDate
        ? snapshot ? projectDisplayDate(dueDate, snapshot, "changed") : format(dueDate, dueDate.getFullYear() === new Date().getFullYear() ? "dd MMM" : "dd MMM yyyy")
        : null;

    return (
        <div
            suppressHydrationWarning={!snapshot}
            className={cn(
                inboxConfig.bulkSelectionStyling.content(isIbxSlctd),
                rowFill
                    ? "flex-1 min-w-0 truncate"
                    : flipMentionHierarchy
                        ? "truncate flex-column md:flex-1 md:basis-0 md:min-w-0"
                        : "flex-1 truncate flex-column md:min-w-[90px]",
                flipMentionHierarchy && !isIbxSlctd && "font-medium text-white-black"
            )}
        >
            <span
                suppressHydrationWarning={!snapshot}
                className="truncate line-clamp-1 xs:max-w-[92vw] md:max-w-full xs:whitespace-pre-wrap md:whitespace-nowrap"
                style={{
                    fontSize: 13 }}
            >
                {rowFill ? (
                    <RowFillParts projection={snapshot ? projection : undefined} />
                ) : (snapshot || typeof window !== "undefined") && notification.type === "Comment" ? (
                    snapshot && projection ? projection.projectCommentPreview(notification.comment?.text ?? "").text : renderCommentPreview(notification.comment?.text ?? "")
                ) : (
                    notificationReason({ notification, projection: snapshot ? projection : undefined, plain, formattedDueDate, flipMentionHierarchy })
                )}
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
    const div = new window.DOMParser().parseFromString(html, "text/html").body;
    stripQuotedContent(div);
    return div.textContent?.trim() || convertToPlain(html);
}

export function renderCommentMentionSimple(html: string, currentUserId: string | number, projection?: typeof CommentProjection) {
    if (projection) {
        const preview = projection.projectCommentPreview(html, currentUserId);
        return preview.mention ? <>{preview.mention.before}<span className="bg-mention-highlight text-mention-highlight" style={{ borderRadius: "4px", padding: "2px 4px" }}>@{preview.mention.name}</span>{preview.mention.after}</> : preview.text;
    }
  
    const div = new window.DOMParser().parseFromString(html, "text/html").body;
    const fullText = div.textContent || '';
    stripQuotedContent(div);
    const mentionSpan = div.querySelector(`span[data-type="mention"][data-label="name-${currentUserId}"]`);
    let mentionText = '';
    if (mentionSpan) {
        mentionText = mentionSpan.textContent || '';
        const parentText = mentionSpan.parentElement?.textContent || '';
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
    return div.textContent?.trim() || fullText;
  }

export function AgentBoardAccessDecision() {
    const { notification } = useNotificationContext();
    const enabled = useFlag(HTPR_7582_AGENT_ACCESS_REQUEST_FLAG);
    const queryClient = useQueryClient();
    const [result, setResult] = useState<BoardAccessReceipt | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const submitting = useRef(false);
    const request = notification.boardAccessRequest;
    const [clock, setClock] = useState(() => Date.now());
    useEffect(() => { setResult(null); }, [request]);
    useEffect(() => {
        if (!request || request.status !== "pending") return;
        const remaining = new Date(request.expiresAt).getTime() - Date.now();
        const timer = setTimeout(() => setClock(Date.now()), Math.max(0, Math.min(remaining, 2_147_483_647)));
        return () => clearTimeout(timer);
    }, [request]);
    const current = result ?? request;
    if (!enabled || !request || !current) return null;


    const decide = async (decision: "approve" | "decline") => {
        if (submitting.current) return;
        submitting.current = true;
        setBusy(true);
        setError(null);
        try {
            const response = await fetch(`/api/agents/board-access-requests/${request.id}/decision`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ decision }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? "Could not save this decision. Try again.");
            setResult(body.request);
            void queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Could not save this decision. Try again.");
        } finally {
            submitting.current = false;
            setBusy(false);
        }
    };
    const expired = current.status === "pending" && new Date(current.expiresAt).getTime() <= clock;
    const pending = current.status === "pending" && !expired;
    return !enabled ? null : (
        <div className="min-w-0 flex-1 py-2" data-inbox-decision-control="true" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-dense">
                <span>{request.agentName}</span>
                <span className="text-text-light-gray">Board access · {request.boardName}</span>
                <CreatedAtDesktop />
                <CreatedAtMobile />
            </div>
            <article aria-label="Board access decision" className="rounded border border-comment-description-border shadow-md bg-comment-description text-white-black my-[8px] p-4">
                <header className="mb-3 flex items-center justify-between gap-2 text-dense">
                    <span>{request.agentName}</span>
                    <CreatedAtDesktop />
                    <CreatedAtMobile />
                </header>
                <div className="space-y-3 text-content">
                    <p><strong>{request.agentName} asks to join {request.boardName} as a member</strong></p>
                    <p className="whitespace-pre-wrap break-words">Question: {request.reason}</p>
                    <p className="text-dense text-text-light-gray">
                        {request.sameTeam
                            ? `Only you, this agent’s owner, can approve. ${request.boardName} is in the same team. Adds a plain member, exactly like ticking Board access; no role changes.`
                            : `Agent belongs to another team. ${request.boardName} is in a different team from this agent. This request cannot be approved.`}
                    </p>
                    {(!pending || error) && <p role="status" className="text-dense text-text-light-gray">{error ?? (expired ? "This request has expired. No access was added." : current.status === "approved" && current.accessPresent
                        ? `Approved · ${request.agentName} added to ${request.boardName} as a member. No role changed.`
                        : current.status === "declined" ? `Declined · No access added. ${request.agentName} has been told.` : current.nextStep)}</p>}
                    <Link className="text-dense text-hypertasks-purple" href={`/agents/${request.agentId}?boardAccess=${request.projectId}`}>Board access →</Link>
                </div>
                {pending && <div className="mt-3 flex justify-end gap-2">
                    <button type="button" disabled={busy} onClick={() => void decide("decline")} className="rounded-[4px] px-3 py-1.5 text-dense text-text-light-gray hover:bg-hoverCardBackground disabled:opacity-50">Decline</button>
                    <button type="button" disabled={busy || !current.canApprove} onClick={() => void decide("approve")} className="rounded-[4px] bg-shadcn-primary px-3 py-1.5 text-dense font-medium text-primary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50">Approve</button>
                </div>}
            </article>
        </div>
    );
}
