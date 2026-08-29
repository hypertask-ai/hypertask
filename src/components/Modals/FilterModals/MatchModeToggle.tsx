import useFilters from "@/hooks/Homepage/Filters/useFilters";
import { supportsMatchMode, TFilter, TMatchFilters } from "@/models/Filters/model";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { useRecoilValue } from "@/lib/state";
import { currentProjectAtom } from "@/store";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { useEffect, useRef } from "react";
import { HintKey } from "@/components/Common/CommonModalComponents";
import { ToggleFilterType } from "./SelectFilters/ShowFilterOptionsModal";

type Props = {
  type: TFilter;
  noun: "tags" | "assignees";
  view: "Kanban" | "Calendar";
};

/**
 * The ANY/ALL control for ONE filter's own values, shown in that filter's value picker.
 * Deliberately identical to the parent Filters modal's control, keys included: these pickers keep
 * their search input focused (ModalInput re-focuses itself on blur), so a letter shortcut would be
 * swallowed by typing, and Shift+M is already "move task to a different board". Arrow left/right is
 * what the parent modal already uses for exactly this.
 */
const MatchModeToggle = ({ type, noun, view }: Props) => {
  const currentProject = useRecoilValue(currentProjectAtom);
  const { toggleFilterValueMatch } = useFilters();
  const activeFilter = getActiveFiltersFromProject(currentProject).addedFilters.find(
    (filter) => filter.type === type
  );
  const match: TMatchFilters = activeFilter?.match ?? "ANY";
  // Nothing to combine until a value is picked, and toggling then would be a no-op anyway.
  const canToggle =
    view === "Kanban" && supportsMatchMode(type) && !!activeFilter?.searchPayload?.length;

  // The save round-trips before the project state catches up, so two quick presses would both read
  // the same old mode and write the same value. Flip from what we last asked for, and only resync
  // once a genuinely new mode comes back from state.
  const pending = useRef<TMatchFilters>(match);
  const lastSeen = useRef<TMatchFilters>(match);
  if (lastSeen.current !== match) {
    lastSeen.current = match;
    pending.current = match;
  }
  // Two saves in flight at once can also land out of order, leaving the board on the earlier press.
  // Chaining keeps click order, so the last press is the last write.
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const flip = () => {
    const next: TMatchFilters = pending.current === "ALL" ? "ANY" : "ALL";
    pending.current = next;
    writeQueue.current = writeQueue.current
      .catch(() => {})
      .then(() => toggleFilterValueMatch(type, next));
  };

  useEffect(() => {
    if (!canToggle) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.keyCode !== KeyCodes.ARROW_LEFT &&
        event.keyCode !== KeyCodes.ARROW_RIGHT
      ) {
        return;
      }
      // While there is a search query, left/right belong to the caret. Only claim them when the
      // box is empty, which is the state you are in when you have finished picking values.
      const input = event.target as HTMLInputElement | null;
      if (input?.tagName === "INPUT" && input.value) return;
      event.preventDefault();
      flip();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  if (!supportsMatchMode(type)) return null;

  return (
    <div className="flex flex-col items-end gap-1 whitespace-nowrap">
      {canToggle && (
        <ToggleFilterType selectedOption={match} handleFilterChange={flip} noun={noun} />
      )}
      <span className="text-micro text-text-light-gray">
        <HintKey>SHIFT+ESC</HintKey>to go back
      </span>
    </div>
  );
};

export default MatchModeToggle;
