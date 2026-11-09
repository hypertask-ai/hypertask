import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { useGetAllTeamsMinimal } from "@/hooks/MultiPages/useGetAllTeamsMinimal";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { currentUserAtom, fullScreenChatScopeAtom, recentChatBoardIdsAtom } from "@/store";
import { sortBoardsByRecent } from "@/utils/aiChat/sortBoardsByRecent";
import { ITeam } from "@/models/model";
import AudioButton from "../RTE/Components/AudioButton";
import OptionPickerModal from "@/components/Modals/OptionPicker";
import { ChatScopeChip } from "./ChatScopeChip";
import { SendMessageButton } from "./SendMessageButton";
import { ComposerPlusActions } from "@/components/Common/ComposerPlusActions";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8824_AI_CHAT_ONE_COMPOSER_FLAG } from "@/lib/flags/definitions/htpr-8824-ai-chat-one-composer";

const menuItemClass =
  "flex items-center justify-between gap-6 rounded-[4px] px-2 py-1.5 text-left text-meta text-white-black hover:bg-hover-active";

export function AiChatOneComposerRow({
  active,
  audioButtonId,
  empty,
  hasText,
  streamControl,
}: {
  active: boolean;
  audioButtonId: string;
  empty: boolean;
  hasText: boolean;
  streamControl: ReactNode;
}) {
  const {
    editor,
    isTyping,
    isRecording,
    isByokBlocked,
    toggleRecording,
    audioTiptapCallback,
    handleAttachmentClick,
    handleAddContext,
    handleSendMessage,
  } = useAiChatContext();
  const sharedPlusMenu = useFlag(HTPR_8824_AI_CHAT_ONE_COMPOSER_FLAG);
  const plusMenu = useRef<HTMLDetailsElement>(null);
  const closePlusMenu = () => {
    if (plusMenu.current) plusMenu.current.open = false;
  };

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const menu = plusMenu.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !plusMenu.current?.open) return;
      event.preventDefault();
      event.stopPropagation();
      closePlusMenu();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return (
    <div data-ai-chat-one-row className="flex w-full items-center justify-between pt-2">
      {sharedPlusMenu ? (
        <ComposerPlusActions active={active} onAttach={handleAttachmentClick} onAddContext={handleAddContext} />
      ) : (
        <details ref={plusMenu} className="relative">
          <summary
            aria-label="Add"
            className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-[4px] text-icon-dark-gray hover:bg-hover-active hover:text-white-black [&::-webkit-details-marker]:hidden"
          >
            <Plus size={18} strokeWidth={1.75} aria-hidden />
          </summary>
          <div role="group" aria-label="Add" className="absolute bottom-[calc(100%+0.25rem)] left-0 z-popup flex min-w-44 flex-col rounded-[4px] bg-modalBackground p-1 shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
            <button type="button" aria-label="Attach file" className={menuItemClass}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { closePlusMenu(); handleAttachmentClick(); }}>
              <span>Attach file</span>
            </button>
            <button type="button" aria-label="Add context" className={menuItemClass}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { closePlusMenu(); handleAddContext(); }}>
              <span>Add context</span>
              <span className="text-text-light-gray">@</span>
            </button>
          </div>
        </details>
      )}
      <div className="flex shrink-0 items-center gap-2">
        {streamControl}
        <AudioButton
          callbackHandler={audioTiptapCallback}
          editor={editor}
          id={audioButtonId}
          active={active}
          toggleRecording={toggleRecording!}
          globalRecording={isRecording}
          hasText={hasText}
          ariaLabel="Start dictation"
          compactListeningPill
          primaryMic
          hideDevicePicker
          stopButtonId={`${audioButtonId}-stop`}
        />
        {(!isTyping || !empty) && (
          <SendMessageButton
            label="Send"
            textButton
            disabled={empty || isByokBlocked}
            isByokBlocked={isByokBlocked}
            queueMode={isTyping}
            mobile={false}
            onClick={() => handleSendMessage()}
          />
        )}
      </div>
    </div>
  );
}

export function AiChatOneComposerBelowRow({
  fullScreen,
  dockedScope,
  modelPicker,
  onRestoreFocus,
}: {
  fullScreen: boolean;
  dockedScope: ReactNode;
  modelPicker: ReactNode;
  onRestoreFocus: () => void;
}) {
  return (
    <div data-ai-chat-one-below-row className="flex w-full items-center justify-between gap-2 pt-2">
      {fullScreen ? <FullScreenBoardPicker onRestoreFocus={onRestoreFocus} /> : dockedScope}
      {modelPicker}
    </div>
  );
}

function FullScreenBoardPicker({ onRestoreFocus }: { onRestoreFocus: () => void }) {
  const currentUser = useRecoilValue(currentUserAtom);
  const [scope, setScope] = useRecoilState(fullScreenChatScopeAtom);
  const [recentChatBoardIds, setRecentChatBoardIds] = useRecoilState<number[]>(recentChatBoardIdsAtom);
  const { data: allTeams } = useGetAllTeamsMinimal(currentUser?.id ?? null);
  const [isOpen, setIsOpen] = useState(false);
  const teams = useMemo(
    () => sortBoardsByRecent((allTeams ?? []) as ITeam[], recentChatBoardIds),
    [allTeams, recentChatBoardIds],
  );
  const picked = teams.flatMap((team) => team.projects).find((project) => project.id === scope);
  const close = () => {
    setIsOpen(false);
    requestAnimationFrame(onRestoreFocus);
  };
  return (
    <div data-ai-chat-scope data-ai-chat-full-screen-scope className="relative inline-block min-w-0 max-w-full shrink-0 text-left">
      <ChatScopeChip
        kind={scope === null ? "boards" : "board"}
        label={picked ? picked.title ?? picked.name : scope === null ? "All boards" : `Board ${scope}`}
        isOpen={isOpen}
        aria-haspopup="dialog"
        onClick={() => setIsOpen((open) => !open)}
      />
      {isOpen && (
        <OptionPickerModal
          header="Chat boards"
          options={[
            { id: null, label: "All boards", checked: scope === null },
            ...teams.flatMap((team) =>
              team.projects.map((project) => ({ id: project.id, label: project.title ?? project.name, hint: team.title, checked: scope === project.id })),
            ),
          ]}
          onClose={close}
          onSelect={({ id }) => {
            if (id !== null && typeof id !== "number") return;
            const nextScope: number | null = id;
            if (nextScope !== null) setRecentChatBoardIds((ids) => [nextScope, ...ids.filter((value) => value !== nextScope)].slice(0, 12));
            setScope(nextScope);
            close();
          }}
        />
      )}
    </div>
  );
}
