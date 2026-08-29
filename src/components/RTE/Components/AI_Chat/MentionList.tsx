import { MentionListRows } from "@/components/AI_CHAT/MentionListComp";
import { showMentionListAtom } from "@/store";
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { useRecoilState } from "@/lib/state";
import { MentionItem } from "@/models/model";
import { DIV_ID_CONSTANTS, generalConfig } from "@/lib/configs/general.config";
import {
  firstSelectableMentionIndex,
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

const MentionList = forwardRef<MentionListRef, MentionListProps>(
  (props, ref) => {
    const ignoreItems: string[] = [...NON_SELECTABLE_MENTION_TYPES];
    const [selectedIndex, setSelectedIndex] = useState<number>(() =>
      firstSelectableMentionIndex(props.items ?? []),
    );
    const [___, setShowMentionList] = useRecoilState(showMentionListAtom);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    // --- HELPER FUNCTIONS ---
    const selectItem = (index: number): void => {
      const item = props.items[index];
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

        // Call the contextCallback if it exists to send data back to useAiChat
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

    // --- KEYDOWN HANDLERS ---
    const upHandler = (): void => {
      const nextIndex = nextSelectableMentionIndex(
        props.items,
        selectedIndex,
        -1,
      );
      if (nextIndex < 0) return;
      setSelectedIndex(nextIndex);
      scrollToIndex(nextIndex);
    };

    const downHandler = (): void => {
      const nextIndex = nextSelectableMentionIndex(
        props.items,
        selectedIndex,
        1,
      );
      if (nextIndex < 0) return;
      setSelectedIndex(nextIndex);
      scrollToIndex(nextIndex);
    };

    const enterHandler = (): void => selectItem(selectedIndex);

    // --- CONSOLIDATED USEEFFECT ---
    useEffect(() => {
      // On small screens, prevent background page scroll while the mention list is open
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

      // If items haven't arrived yet for the current query, stay in a loading state.
      if (!props.items || props.items.length === 0) {
        setIsLoading(true);
      } else {
        // Once items arrive, stop loading.
        setIsLoading(false);
        setSelectedIndex(firstSelectableMentionIndex(props.items));
      }

      // Cleanup function to hide the list when the component unmounts or query changes.
      return () => {
        if (isMobile && typeof document !== "undefined") {
          document.body.style.overflow = previousOverflow || "";
        }
      };
    }, [props.items, props.query]); // Effect runs when items OR query change.

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

    const hasItems = props.items?.length > 3;
    const noResults = hasItems && props.items[0]?.type === "no-results";

    return (
      <MentionListRows
        id={DIV_ID_CONSTANTS.aiMentionList}
        selectedIndex={selectedIndex}
        items={props.items}
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
