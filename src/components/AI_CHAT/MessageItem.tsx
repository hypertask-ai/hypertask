import { useFlag } from "@/hooks/useFlag";
import { HTPR_8261_CHAT_CLEANUP_FLAG } from "@/lib/flags/definitions/htpr-8261-chat-cleanup";
import { HTPR_8263_FULL_SCREEN_CHAT_CLEANUP_FLAG } from "@/lib/flags/definitions/htpr-8263-full-screen-chat-cleanup";
import AiChatTicketRows from "./AiChatTicketRows";
import { HTPR_7683_AI_CHAT_TICKET_ROWS_FLAG } from "@/lib/flags/definitions/htpr-7683-ai-chat-ticket-rows";
import { HTPR_7772_FULLSCREEN_CHAT_HANDOFF_FLAG } from "@/lib/flags/definitions/htpr-7772-fullscreen-chat-handoff";
import { HTPR_7751_OWN_KEY_REJECTED_FLAG } from "@/lib/flags/definitions/htpr-7751-own-key-rejected";
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
import { usePathname, useRouter } from "next/navigation";
import { Copy, Pencil, Plus, RotateCw, type LucideIcon } from "lucide-react";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { normalizeAssistantHtml } from "@/utils/helperFunctions/normalizeAssistantHtml";
import { sanitizeAiHtml } from "@/utils/helperFunctions/sanitizeHtml";
import {
  wrapTablesInMessageHtml,
  interceptMessageLinkClick,
} from "@/utils/helperFunctions/messageHtmlLinks";
import { TypingIndicator } from "./TypingIndicator";
import { extractSettingCards } from "@/lib/ai/settings/catalog";
import { HTPR_7779_SKILL_OFFERS_FLAG } from "@/lib/flags/definitions/htpr-7779-skill-offers";
import { extractSkillOfferIds, type SkillOfferCard } from "@/lib/ai/skillOffers/contract";
import { actOnSkillOffer, fetchSkillOffer, skillOfferDraftMessage } from "@/lib/ai/skillOffers/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import SettingsCard from "@/components/Modals/Settings/SettingsCard";
import { settingsActionButtonClass } from "@/components/Modals/Settings/SettingsBillingRow";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { cn } from "@/utils/undoActions/helperFuncs";

const AiSettingChangeCard = dynamic(() => import("./AiSettingChangeCard").then((module) => module.AiSettingChangeCard), { ssr: false });

const AiSkillOfferCard = ({ id }: { id: string }) => {
  const enabled = useFlag(HTPR_7779_SKILL_OFFERS_FLAG);
  const user = useRecoilValue(currentUserAtom);
  const queryClient = useQueryClient();
  const { handleSendMessage } = useAiChatContext();
  const [busy, setBusy] = useState(false);
  const processing = useRef(false);
  const [error, setError] = useState<string>();
  const queryKey = ["ai-skill-offer", user?.id, id];
  const query = useQuery<SkillOfferCard>({
    queryKey,
    enabled: enabled && !!user?.id,
    queryFn: () => fetchSkillOffer(id),
    retry: false,
  });
  const offer = query.data;

  const act = async (action: "draft" | "dismiss" | "save") => {
    if (processing.current) return;
    processing.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const updated = await actOnSkillOffer(id, action);
      queryClient.setQueryData(queryKey, updated);
      if (action === "draft") await handleSendMessage(skillOfferDraftMessage(updated.rule));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not update skill suggestion");
    } finally {
      processing.current = false;
      setBusy(false);
    }
  };

  if (!enabled) return null;
  const buttonClass = cn(settingsActionButtonClass, MOBILE_TARGET, "text-text-light-gray");
  const primaryClass = cn(buttonClass, "bg-shadcn-primary text-primary-foreground hover:bg-shadcn-primary disabled:text-primary-foreground disabled:opacity-50");
  return (
    <div className="rounded-[4px] bg-modalBackground p-3" aria-busy={busy}>
      <SettingsCard title="Skill suggestion">
        {offer ? (
          <>
            <p className="break-words">You gave this instruction {offer.occurrences} times across {offer.sessionCount} chats on this board.</p>
            <p className="break-words font-medium">{offer.rule}</p>
            {offer.quotes[0] && <p className="break-words text-text-light-gray">You wrote: “{offer.quotes[0]}”</p>}
            <p className="break-words text-text-light-gray">
              {offer.kind === "skill"
                ? "It reads as a multi-step procedure, so it fits a skill. Nothing is saved until you approve the draft."
                : "It reads as a one-line preference, so it fits a board memory rule."}
            </p>
            {offer.status === "pending" && (
              <div className="flex justify-end gap-2">
                <button type="button" className={buttonClass} disabled={busy} onClick={() => void act("dismiss")}>Not now</button>
                {offer.kind === "skill"
                  ? <button type="button" className={primaryClass} disabled={busy} onClick={() => void act("draft")}>Draft it</button>
                  : <button type="button" className={primaryClass} disabled={busy} onClick={() => void act("save")}>Save board rule</button>}
              </div>
            )}
            {offer.status === "drafted" && <p role="status">Drafting in chat. Nothing is saved until you approve it.</p>}
            {offer.status === "saved" && <p role="status">Saved to board memory.</p>}
            {offer.status === "dismissed" && <p role="status">Not now. This will not be suggested again.</p>}
          </>
        ) : (
          <p className="text-text-light-gray">{query.isPending ? "Loading suggestion…" : query.error?.message}</p>
        )}
        {error && <p role="alert" className="text-meta text-text-light-gray">{error}</p>}
      </SettingsCard>
    </div>
  );
};

const AttachmentsCarousel = dynamic(
  () => import("@/components/Common/AttachmentsView/AttachmentsCarousel"),
  { ssr: false }
);

export const MessageItem: FC<IMessageItemProps> = ({
  message,
  copyResponse,
  createTaskFromResponse,
  retryStream,
  editMessage,
}) => {
  const ticketRowsEnabled = useFlag(HTPR_7683_AI_CHAT_TICKET_ROWS_FLAG);
  const cleanupEnabled = useFlag(HTPR_8263_FULL_SCREEN_CHAT_CLEANUP_FLAG);
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
        {message.role === "assistant" && message.authorAgent?.displayName && (
          <div className="text-micro text-icon-dark-gray px-2">
            {message.authorAgent.displayName}
          </div>
        )}
        <div
          className={`flex flex-col min-w-0 max-w-full py-1 px-2 ${cleanupEnabled ? "rounded-[4px]" : "rounded"} gap-2 w-full ${
            message.role === "human"
              ? "bg-ai-tiptap text-white-black"
              : " text-white-black w-full "
          }`}
        >
          <SubMessage message={message} key={message.id} ticketGroups={ticketRowsEnabled ? message.ticketGroups : undefined} />
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

const isOwnKeyRejectedContent = (trimmed: string) =>
  /^Your (OpenAI|Claude|Google|DeepSeek|Moonshot|Z\.ai|Alibaba|OpenRouter|custom|Baseten) key was rejected\. Update it in Settings, AI, Bring your own key\.$/.test(trimmed);

const isKnownAssistantError = (trimmed: string) =>
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
  const ownKeyRejected = useFlag(HTPR_7751_OWN_KEY_REJECTED_FLAG);
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
    const trimmed = message.content.trim();
    if (isKnownAssistantError(trimmed) || (ownKeyRejected && isOwnKeyRejectedContent(trimmed))) {
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
  const chatCleanupEnabled = useFlag(HTPR_8261_CHAT_CLEANUP_FLAG);
  const pathname = usePathname();
  if (agentStatus && chatCleanupEnabled && !pathname?.startsWith("/chat")) {
    return <div data-chat-status-indicator className="font-bold text-white-black">{agentStatus}</div>;
  }
  if (agentStatus) {
    return (
      <div data-chat-status-indicator>
        <div className="relative transition-all duration-300 ease-linear">
          <span className="invisible font-bold">{agentStatus}</span>
          <span className="absolute inset-0 bg-gradient-to-r font-bold from-hypertasks-header-blue via-hypertasks-ai-purple to-hypertasks-header-blue bg-clip-text text-transparent animate-gradient">
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
      data-chat-typing-cursor
      data-chat-cleanup={chatCleanupEnabled && !pathname?.startsWith("/chat") ? "" : undefined}
      className={showCursor ? "inline-block" : "hidden"}
    />
  );
};

const SubMessage = ({ message, ticketGroups }: { message: IChatMessage; ticketGroups?: IChatMessage["ticketGroups"] }) => {
  const hasAnimated = useRef(false);
  const [showCursor, setShowCursor] = useState(!message.isDelivered);
  const router = useRouter();
  const pathname = usePathname();
  const { agentStatus, togglePopover, showAiChatInterface, openDockedChat } =
    useAiChatContext();
  const isMbl = useContext(MobileViewContext);
  const handoffEnabled = useFlag(HTPR_7772_FULLSCREEN_CHAT_HANDOFF_FLAG);
  const skillOffersEnabled = useFlag(HTPR_7779_SKILL_OFFERS_FLAG);

  const revealNavigationTarget = () => {
    if (isMbl && showAiChatInterface) togglePopover();
  };

  const followInternalLink = () => {
    if (handoffEnabled && !isMbl && (pathname?.startsWith("/chat") ?? false)) openDockedChat();
    revealNavigationTarget();
  };

  const settingCards = useMemo(() => message.role === "assistant" ? extractSettingCards(message.content) : { html: message.content, ids: [] }, [message.content, message.role]);
  const skillOfferCards = useMemo(
    () => message.role === "assistant" && skillOffersEnabled
      ? extractSkillOfferIds(settingCards.html)
      : { html: settingCards.html, ids: [] },
    [settingCards.html, message.role, skillOffersEnabled],
  );
  const messageHtmlWithTableScroll = useMemo(
    () => {
      const content =
        message.role === "assistant"
          ? normalizeAssistantHtml(skillOfferCards.html)
          : skillOfferCards.html;
      return wrapTablesInMessageHtml(sanitizeAiHtml(content));
    },
    [skillOfferCards.html, message.role]
  );

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    interceptMessageLinkClick(event, router, followInternalLink);
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
      <div data-chat-content-container onClick={handleClick}>
        <div
          data-chat-content-html
          className={contentClass}
          dangerouslySetInnerHTML={{ __html: messageHtmlWithTableScroll }}
        />
        {settingCards.ids.map((id) => <AiSettingChangeCard key={id} id={id} />)}
        {skillOffersEnabled && skillOfferCards.ids.map((id) => <AiSkillOfferCard key={id} id={id} />)}
        {message.role === "assistant" && message.isDelivered && ticketGroups?.length ? <AiChatTicketRows groups={ticketGroups} onNavigate={(url) => { followInternalLink(); router.push(url); }} /> : null}
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

