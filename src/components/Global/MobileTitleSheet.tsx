"use client";

import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, Search, SquareKanban } from "lucide-react";
import { useRecoilValue } from "@/lib/state";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { IProject } from "@/models/model";
import { useGetAllAccessibleBoardList } from "@/hooks/MultiPages/useGetAllAccessibleBoardList";
import { MobileBottomSheet } from "@/components/Modals/Sheets";
import { ModalInput } from "@/components/Common/CommonModalComponents";
import {
  getMobileBoardSwitcherOptions,
  getMobileBoardOptionId,
  getNextMobileBoardSelection,
} from "@/lib/mobileBoardSwitcher";
import type { BoardLastActivity } from "@/lib/boardSwitcherOrder";
import { markBoardSwitchIntent } from "@/lib/analytics/boardSwitchLatency";

const EMPTY_BOARDS: IProject[] = [];

/**
 * Board switcher. Views live in the header strip now, so this is boards only:
 * title tap switches BOARD, strip switches VIEW, horizontal scroll moves
 * between COLUMNS. One concept per surface.
 */
const MobileTitleSheet = ({ onClose }: { onClose: () => void }) => {
  const router = useRouter();
  const currentProject = useRecoilValue(currentProjectAtom);
  const currentUser = useRecoilValue(currentUserAtom);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [keyword, setKeyword] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lastActivity, setLastActivity] = useState<BoardLastActivity | null>(
    null,
  );

  // This component mounts only after explicit switcher intent. Keep its fetch
  // independent from the route-authoritative projectsAll query: a second
  // observer on that singleton key could otherwise cancel or overwrite the
  // Board request whose scope/request ID LandingPage is reconciling.
  const {
    data: accessibleBoards = EMPTY_BOARDS,
    isFetching: accessibleBoardsLoading,
    isError: accessibleBoardsError,
    refetch: refetchAccessibleBoards,
  } = useGetAllAccessibleBoardList(currentUser, {
    enabled: !!currentUser?.id,
  });

  const boards: IProject[] =
    !accessibleBoardsLoading &&
    !accessibleBoardsError &&
    Array.isArray(accessibleBoards)
      ? accessibleBoards
      : EMPTY_BOARDS;

  const filteredBoards = useMemo(
    () =>
      getMobileBoardSwitcherOptions({
        projects: boards,
        lastActivity,
        currentProjectId: currentProject?.id,
        keyword,
      }),
    [boards, currentProject?.id, keyword, lastActivity],
  );

  useEffect(() => {
    setLastActivity(null);
    if (!currentUser?.id) return;

    const controller = new AbortController();
    void fetch("/api/projects/lastActivity", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: BoardLastActivity) => {
        setLastActivity(
          data && typeof data === "object" && !Array.isArray(data) ? data : {},
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setLastActivity({});
      });

    return () => controller.abort();
  }, [currentUser?.id]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredBoards]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const openBoard = (board: IProject) => {
    onClose();
    markBoardSwitchIntent({ surface: "mobile", projectId: board.id });
    router.push(`/project?id=${board.id}`);
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setKeyword(event.target.value);
    setSelectedIndex(0);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const selectedBoard = filteredBoards[selectedIndex];
      if (selectedBoard) openBoard(selectedBoard);
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    event.preventDefault();
    const nextIndex = getNextMobileBoardSelection(
      selectedIndex,
      filteredBoards.length,
      event.key,
    );
    setSelectedIndex(nextIndex);
    const selectedBoard = filteredBoards[nextIndex];
    if (selectedBoard) {
      window.requestAnimationFrame(() => {
        document
          .getElementById(getMobileBoardOptionId(selectedBoard.id))
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  };

  const searchInput = (
    <div className="flex items-center gap-2.5 border-t border-light-black-border-1 px-4">
      <Search
        strokeWidth={1.75}
        size={16}
        className="shrink-0 text-text-light-gray"
        aria-hidden
      />
      <ModalInput
        ref={searchInputRef}
        id="mobile-board-switcher-search"
        aria-label="Search boards"
        aria-controls="mobile-board-switcher-options"
        aria-activedescendant={
          filteredBoards[selectedIndex]
            ? getMobileBoardOptionId(filteredBoards[selectedIndex].id)
            : undefined
        }
        autoFocus
        placeholder="Search boards"
        onChange={handleSearchChange}
        onKeyDown={handleSearchKeyDown}
        value={keyword}
        className="px-0"
      />
    </div>
  );

  return (
    <MobileBottomSheet
      onClose={onClose}
      ariaLabel="Switch board"
      fullHeight
      keyboardAware
      bottomSlot={searchInput}
    >
      <div className="pb-[env(safe-area-inset-bottom)]">
        <p className="px-4 pb-1 pt-2 text-micro font-bold uppercase tracking-wider text-text-light-gray">
          Boards
        </p>
        {boards.length === 0 && accessibleBoardsError ? (
          <div className="px-4 py-6 text-content text-text-light-gray">
            <p>Couldn’t load boards.</p>
            <button
              type="button"
              onClick={() => void refetchAccessibleBoards()}
              className="mt-2 min-h-11 font-semibold text-white-black"
            >
              Try again
            </button>
          </div>
        ) : boards.length === 0 || lastActivity === null ? (
          // Never render an empty sheet again: an explicit line is a state the
          // user can read, a zero-height list is a broken control.
          <p className="px-4 py-6 text-content text-text-light-gray">
            {accessibleBoardsLoading || lastActivity === null
              ? "Loading boards…"
              : "No boards yet."}
          </p>
        ) : null}
        {lastActivity !== null &&
        boards.length > 0 &&
        filteredBoards.length === 0 ? (
          <p className="px-4 py-6 text-content text-text-light-gray">
            No matching boards.
          </p>
        ) : null}
        <div
          id="mobile-board-switcher-options"
          role="listbox"
          aria-label="Boards"
        >
          {filteredBoards.map((board, index) => (
            <button
              key={board.id}
              type="button"
              id={getMobileBoardOptionId(board.id)}
              role="option"
              aria-selected={index === selectedIndex}
              onClick={() => openBoard(board)}
              className={`flex min-h-[52px] w-full items-center gap-3 border-b border-light-black-border-1 px-4 text-left text-content text-white-black transition-colors duration-75 ${
                index === selectedIndex ? "bg-active-modal-element" : ""
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-label-span text-text-light-gray">
                <SquareKanban size={16} strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {board.title ?? board.name}
              </span>
              {board._count?.tasks ? (
                <span className="shrink-0 text-meta text-text-light-gray">
                  {board._count.tasks}
                </span>
              ) : null}
              {board.id === currentProject?.id ? (
                <Check
                  size={16}
                  strokeWidth={1.75}
                  className="shrink-0 text-text-light-gray"
                />
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </MobileBottomSheet>
  );
};

export default MobileTitleSheet;
