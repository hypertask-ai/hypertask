import { MentionListRows } from "@/components/AI_CHAT/MentionListComp";
import { showMentionListAtom } from "@/store";
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8048_AGENT_SESSIONS_FLAG } from "@/lib/flags/definitions/htpr-8048-agent-sessions";
import { useRecoilState } from "@/lib/state";
import { MentionItem } from "@/models/model";
import { DIV_ID_CONSTANTS, generalConfig } from "@/lib/configs/general.config";
import {
  firstSelectableMentionIndex,
  moveAgentMentionsFirst,
  nextSelectableMentionIndex,
  NON_SELECTABLE_MENTION_TYPES,
} from "../../mentionNavigation";

interface MentionCommandData {
  id: number | string;
  label: string;
  projectId?: number;
  uniqueIndex?: number;
  text: string;
}

interface MentionListProps {
  items: MentionItem[];
  command: (data: MentionCommandData) => void;
  query?: string;
  contextCallback?: (data: any) => void;
}

interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  (props, ref) => {
    const ignoreItems: string[] = [...NON_SELECTABLE_MENTION_TYPES];
    const agentsFirst = useFlag(HTPR_8048_AGENT_SESSIONS_FLAG);
    const sourceItems = props.items;
    const items = useMemo(
      () => (agentsFirst && sourceItems ? moveAgentMentionsFirst(sourceItems) : sourceItems),
      [agentsFirst, sourceItems],
    );
    const [selectedIndex, setSelectedIndex] = useState<number>(() =>
      firstSelectableMentionIndex(items ?? []),
    );
    const [___, setShowMentionList] = useRecoilState(showMentionListAtom);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    const selectItem = (index: number): void => {
      const item = items[index];
      if (item && !ignoreItems.includes(item.type)) {
        let mentionData;

        if (item.type === "task") {
          mentionData = {
            projectId: item.project_id,
            uniqueIndex: item.index,
            id: item.id,
            text: `${item.ticketNumber} ${item.name}`,
            label: "task"
          };
          props.command(mentionData);
        } else if (item.type === "project") {
          mentionData = {
            id: item.id,
            projectId: item.id,
            text: `${item.identifier} ${item.name}`,
            label: "project"
          };
          props.command(mentionData);
        } else if (item.type === "name") {
          mentionData = {
            id: item.id,
            text: `${item.name}`,
            label: "name"
          };
          props.command(mentionData);
        } else if (item.type === "agent") {
          mentionData = {
            id: item.id,
            text: item.name,
            label: "agent"
          };
          props.command(mentionData);
        }

        if (props.contextCallback && mentionData) {
          props.contextCallback(item);
        }
      }
    };

    const scrollToIndex = (index: number): void => {
      document.getElementById(`mention-button-${index}`)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    };

    const upHandler = (): void => {
      const nextIndex = nextSelectableMentionIndex(
        items,
        selectedIndex,
        -1,
      );
      if (nextIndex < 0) return;
      setSelectedIndex(nextIndex);
      scrollToIndex(nextIndex);
    };

    const downHandler = (): void => {
      const nextIndex = nextSelectableMentionIndex(
        items,
        selectedIndex,
        1,
      );
      if (nextIndex < 0) return;
      setSelectedIndex(nextIndex);
      scrollToIndex(nextIndex);
    };

    const enterHandler = (): void => selectItem(selectedIndex);

    useEffect(() => {
      const isMobile =
        typeof window !== "undefined" &&
        window.matchMedia("(max-width: 640px)").matches;
      const previousOverflow =
        typeof document !== "undefined"
          ? document.body.style.overflow
          : undefined;
      if (isMobile && typeof document !== "undefined") {
        document.body.style.overflow = "hidden";
      }

      if (!items || items.length === 0) {
        setIsLoading(true);
      } else {
        setIsLoading(false);
        setSelectedIndex(firstSelectableMentionIndex(items));
      }

      return () => {
        if (isMobile && typeof document !== "undefined") {
          document.body.style.overflow = previousOverflow || "";
        }
      };
    }, [items, props.query]);

    useEffect(() => {
      setShowMentionList(true);
      return () => {
        setTimeout(() => setShowMentionList(false), 200);
      };
    }, []);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }): boolean => {
        if (event.key === "ArrowUp") {
          upHandler();
          return true;
        }
        if (event.key === "ArrowDown") {
          downHandler();
          return true;
        }
        if (event.key === "Enter") {
          if (agentsFirst && items[selectedIndex]?.type === "agent") {
            event.preventDefault();
            event.stopPropagation();
          }
          enterHandler();
          return true;
        }
        if (event.key === "Escape") {
          setShowMentionList(false);
          return true;
        }
        return false;
      },
    }));

    const hasItems = items?.length > 3;
    const noResults = hasItems && items[0]?.type === "no-results";

    return (
      <MentionListRows
        id={DIV_ID_CONSTANTS.aiMentionList}
        selectedIndex={selectedIndex}
        items={items}
        selectItem={selectItem}
        setSelectedIndex={setSelectedIndex}
        ignoreItems={ignoreItems}
        isLoading={isLoading}
        hasItems={hasItems}
        noResults={noResults}
        className="max-h-[20rem]"
      />
    );
  }
);

MentionList.displayName = "MentionList";

export default MentionList;
