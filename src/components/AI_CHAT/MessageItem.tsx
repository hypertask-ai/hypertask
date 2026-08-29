// components/MessageItem.tsx
import AttachmentView from "@/components/Common/AttachmentsView";
import { IMessageItemProps } from "@/models/AICHATMODELS";
import { IChatMessage, TCarousalItems } from "@/models/model";
import dynamic from "next/dynamic";
import formatDateDifference from "@/utils/generateTime";
import {
  FC,
  KeyboardEvent,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import "@/styles/messageItem.scss";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Plus, RotateCw, type LucideIcon } from "lucide-react";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { normalizeAssistantHtml } from "@/utils/helperFunctions/normalizeAssistantHtml";
import { sanitizeAiHtml } from "@/utils/helperFunctions/sanitizeHtml";
import { TypingIndicator } from "./TypingIndicator";

const AttachmentsCarousel = dynamic(
  () => import("@/components/Common/AttachmentsView/AttachmentsCarousel"),
  { ssr: false }
);

const TABLE_SCROLL_WRAPPER_CLASS = "message-table-scroll";

/**
 * Wrap each top-level <table>…</table> in a scroll container in the HTML string.
 * Must run here (not via useLayoutEffect DOM hacks): React reapplies dangerouslySetInnerHTML
 * on every render, which wipes any nodes added after commit.
 */
function wrapTablesInMessageHtml(html: string): string {
  if (!html) return html;
  const lower = html.toLowerCase();
  if (lower.indexOf("<table") === -1) return html;
  if (html.includes(`class="${TABLE_SCROLL_WRAPPER_CLASS}"`)) return html;

  let out = "";
  let i = 0;

  while (i < html.length) {
    const idx = lower.indexOf("<table", i);
    if (idx === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, idx);

    let pos = html.indexOf(">", idx) + 1;
    if (pos <= idx) pos = idx + 6;

    let depth = 1;
    let end = -1;

    while (depth > 0 && pos < html.length) {
      const nextOpen = lower.indexOf("<table", pos);
      const nextClose = lower.indexOf("</table>", pos);

      if (nextClose === -1) {
        end = -1;
        break;
      }

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        const afterOpen = html.indexOf(">", nextOpen) + 1;
        pos = afterOpen > nextOpen ? afterOpen : nextOpen + 6;
      } else {
        depth -= 1;
        if (depth === 0) {
          end = nextClose + "</table>".length;
          break;
        }
        pos = nextClose + "</table>".length;
      }
    }

    if (end === -1) {
      out += html.slice(idx);
      break;
    }

    out += `<div class="${TABLE_SCROLL_WRAPPER_CLASS}">${html.slice(idx, end)}</div>`;
    i = end;
  }

  return out;
}

export const MessageItem: FC<IMessageItemProps> = ({
  message,
  copyResponse,
  createTaskFromResponse,
  retryStream,
  editMessage,
}) => {
  const [carouselItems, setCarouselItems] = useState<TCarousalItems>(undefined);
  const attachments = message.attachments;
  const hasAttachments = Boolean(attachments?.length);

  return (
    <div
      className={`flex min-w-0 max-w-full text-meta ${
        message.role === "human" ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`group/msg min-w-0 max-w-full text-left ${
          message.role === "assistant" ? "w-full" : ""
        }`}
      >
        {hasAttachments && attachments && (
            <AttachmentView
              active
              compact
              alignEnd={message.role === "human"}
              attachments={attachments}
              setCarousalItems={setCarouselItems}
            />
        )}
        <div
          className={`flex flex-col min-w-0 max-w-full py-1 px-2 rounded gap-2 w-full ${
            message.role === "human"
              ? "bg-ai-tiptap text-white-black"
              : " text-white-black w-full "
          }`}
        >
          <SubMessage message={message} key={message.id} />
        </div>
        {message.isDelivered && (
          <div className={`mt-0.5 flex w-full max-md:opacity-100 
          gap-2 transition-opacity duration-150 md:opacity-0 
          md:group-hover/msg:opacity-100
          ${message.role === "human" ? "justify-end" : "justify-start px-2 "}
          `}>
            <div className={`text-micro leading-3 opacity-70`}>
              {formatDateDifference(new Date(message.createdAt))}
            </div>
            <DeliveredMessageActions
              message={message}
              copyResponse={copyResponse}
              createTaskFromResponse={createTaskFromResponse}
              retryStream={retryStream}
              editMessage={editMessage}
            />
          </div>
        )}
        {carouselItems && (
          <AttachmentsCarousel
            attachments={carouselItems.attachments}
            currentIndex={carouselItems.currentIndex}
            closeCallback={() => setCarouselItems(undefined)}
          />
        )}
      </div>
    </div>
  );
};


const ASSISTANT_ERROR_MESSAGES = [
  "Sorry, an error occurred while processing your request.",
  "Stream cancelled.",
  "Sorry, I'm having trouble responding right now.",
] as const;

const isAssistantErrorContent = (trimmed: string) =>
  ASSISTANT_ERROR_MESSAGES.includes(trimmed as (typeof ASSISTANT_ERROR_MESSAGES)[number]);

const handleActionKeyDown = (event: KeyboardEvent, action: () => void) => {
  if (event.keyCode === KeyCodes.ENTER) {
    event.preventDefault();
    action();
  }
};

type ActionIconProps = {
  Icon: LucideIcon;
  ariaLabel: string;
  className: string;
  onClick: () => void;
};

const ActionIcon: FC<ActionIconProps> = ({ Icon, ariaLabel, className, onClick }) => (
  <Icon
    className={className}
    size={14}
    strokeWidth={1.75}
    tabIndex={0}
    role="button"
    aria-label={ariaLabel}
    onClick={onClick}
    onKeyDown={(e: React.KeyboardEvent) => handleActionKeyDown(e, onClick)}
  />
);

const humanIconClass =
  "cursor-pointer focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white rounded";
const assistantIconClass =
  " hover:text-white-black cursor-pointer focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white-black rounded";

type DeliveredMessageActionsProps = {
  message: IChatMessage;
  copyResponse: (message: IChatMessage) => void;
  createTaskFromResponse: (message: IChatMessage) => void;
  retryStream: (message?: IChatMessage) => void;
  editMessage: (message: IChatMessage) => void;
};

const DeliveredMessageActions: FC<DeliveredMessageActionsProps> = ({
  message,
  copyResponse,
  createTaskFromResponse,
  retryStream,
  editMessage,
}) => {
  const iconClass =
    message.role === "human" ? humanIconClass : assistantIconClass;
  const rowClass = "flex items-center gap-1 text-meta text-icon-dark-gray";

  if (message.role === "human") {
    return (
      <div className={rowClass}>
        <ActionIcon
          Icon={Pencil}
          ariaLabel="Edit message"
          className={iconClass}
          onClick={() => editMessage(message)}
        />
        <ActionIcon
          Icon={RotateCw}
          ariaLabel="Retry message"
          className={iconClass}
          onClick={() => retryStream(message)}
        />
        <ActionIcon
          Icon={Copy}
          ariaLabel="Copy message"
          className={iconClass}
          onClick={() => copyResponse(message)}
        />
      </div>
    );
  }

  if (message.role === "assistant") {
    if (isAssistantErrorContent(message.content.trim())) {
      return (
        <div className={rowClass}>
          <ActionIcon
            Icon={RotateCw}
            ariaLabel="Retry message"
            className={iconClass}
            onClick={() => retryStream()}
          />
        </div>
      );
    }

    return (
      <div className={rowClass}>
        <ActionIcon
          Icon={Copy}
          ariaLabel="Copy response"
          className={iconClass}
          onClick={() => copyResponse(message)}
        />
        <ActionIcon
          Icon={Plus}
          ariaLabel="Create task from response"
          className={iconClass}
          onClick={() => createTaskFromResponse(message)}
        />
      </div>
    );
  }

  return null;
};


type AssistantStreamingStatusProps = {
  agentStatus: string | null | undefined;
  showCursor: boolean;
  isContentEmpty: boolean;
};

const AssistantStreamingStatus: FC<AssistantStreamingStatusProps> = ({
  agentStatus,
  showCursor,
  isContentEmpty,
}) => {
  if (agentStatus) {
    return (
      <div className="status-indicator">
        <div className="relative transition-all duration-300 ease-linear">
          <span className="invisible font-bold">{agentStatus}</span>
          <span className="absolute inset-0 bg-gradient-to-r font-bold from-blue-500 via-purple-500 to-blue-500 bg-clip-text text-transparent bg-size-200 animate-gradient">
            {agentStatus}
          </span>
        </div>
      </div>
    );
  }

  if (isContentEmpty) {
    return <TypingIndicator />;
  }

  return (
    <span
      className={`typing-cursor ${showCursor ? "inline-block" : "hidden"}`}
    />
  );
};

const SubMessage = ({ message }: { message: IChatMessage }) => {
  const hasAnimated = useRef(false);
  const [showCursor, setShowCursor] = useState(!message.isDelivered);
  const router = useRouter();
  const { agentStatus, togglePopover, showAiChatInterface } =
    useAiChatContext();
  const isMbl = useContext(MobileViewContext);

  // On mobile the chat is a sheet covering the page, so following a link left the
  // ticket loading invisibly behind it. Opening something means you want to look
  // at it: dismiss the chat. Desktop keeps the chat open beside the content.
  const revealNavigationTarget = () => {
    if (isMbl && showAiChatInterface) togglePopover();
  };

  const messageHtmlWithTableScroll = useMemo(
    () => {
      const content =
        message.role === "assistant"
          ? normalizeAssistantHtml(message.content)
          : message.content;
      return wrapTablesInMessageHtml(sanitizeAiHtml(content));
    },
    [message.content, message.role]
  );

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target && target.tagName === "A") {
      const href = target.getAttribute("href");
      if (href) {
        event.preventDefault();
        // router.push expects a relative path for client-side navigation.
        // Normalize same-origin absolute URLs to relative paths and block
        // script/data-style schemes before falling back to browser navigation.
        try {
          const url = new URL(href, window.location.origin);
          const isHttpNavigation =
            url.protocol === "http:" || url.protocol === "https:";
          const isBrowserNavigationScheme =
            isHttpNavigation ||
            url.protocol === "mailto:" ||
            url.protocol === "tel:";
          const isInternalHypertaskLink =
            url.origin === window.location.origin ||
            url.hostname === "app.hypertask.ai";

          if (!isBrowserNavigationScheme) {
            return;
          }

          if (isHttpNavigation && isInternalHypertaskLink) {
            router.push(`${url.pathname}${url.search}${url.hash}`);
            revealNavigationTarget();
          } else {
            window.location.href = url.href;
          }
        } catch {
          return;
        }
      }
      return;
    }
    if (
      target &&
      target.tagName === "SPAN" &&
      target.getAttribute("data-type") === "mention" &&
      target.getAttribute("data-label") === "task"
    ) {
      const URL = `/detail/project-${target.getAttribute(
        "projectId"
      )}/${target.getAttribute("uniqueIndex")}`;
      event.preventDefault();
      router.push(URL);
      revealNavigationTarget();
    }
  };

  useEffect(() => {
    setShowCursor(!message.isDelivered);

    if (message.isDelivered) {
      hasAnimated.current = true;
    }
  }, [message.isDelivered]);

  const contentClass =
    !hasAnimated.current && !message.isDelivered ? "animate-content" : "";
  const containerClass = `submessage-container ${message.isDelivered ? "delivered" : "typing"
    }`;

  return (
    <div className={containerClass}>
      <div className="content-container" onClick={handleClick}>
        <div
          className={`content-html ${contentClass}`}
          dangerouslySetInnerHTML={{ __html: messageHtmlWithTableScroll }}
        />
        {message.role === "assistant" && !message.isDelivered && (
          <AssistantStreamingStatus
            agentStatus={agentStatus}
            showCursor={showCursor}
            isContentEmpty={message.content.trim().length === 0}
          />
        )}
      </div>
    </div>
  );
};

export default SubMessage;
