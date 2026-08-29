"use client";

import { useMemo, useState } from "react";
import nookies from "nookies";
import { Check, ChevronDown } from "lucide-react";
import { IProject, ITeam } from "@/models/model";
import { currentProjectAtom } from "@/store";
import { useSetRecoilState } from "@/lib/state";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useSettingsTeam } from "./useSettingsTeam";

const SettingsBoardPicker = () => {
  const setCurrentProject = useSetRecoilState(currentProjectAtom);
  const { project, projects, team, teamId } = useSettingsTeam();
  const [open, setOpen] = useState(false);

  const boards = useMemo(() => {
    if (!teamId) return [];

    return projects
      .filter((candidate) => candidate.teamId === teamId)
      .sort((a, b) =>
        (a.title ?? a.name ?? "").localeCompare(b.title ?? b.name ?? ""),
      );
  }, [projects, teamId]);

  const switchBoard = (board: IProject) => {
    if (!teamId) return;
    setOpen(false);

    setCurrentProject({
      ...board,
      teamId,
      team: {
        ...(team ?? board.team ?? {}),
        id: teamId,
        title: team?.title ?? board.team?.title,
      } as ITeam,
    } as IProject);

    nookies.set(null, "previousBoard", `project-${board.id}|&|undefined`, {
      maxAge: 600 * 60 * 24 * 7,
      path: "/",
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center justify-between gap-2 rounded-[5px] bg-active-modal-element px-2 py-1.5 text-left text-content font-medium text-white-black transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none"
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="truncate">
          {project?.title ?? project?.name ?? "Select board"}
        </span>
        <ChevronDown
          strokeWidth={1.75}
          className={cn(
            "h-4 w-4 shrink-0 text-text-light-gray transition",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[260px] overflow-y-auto rounded-[8px] bg-modalBackground p-1 shadow-lg"
          >
            {boards.map((board) => {
              const isActive = board.id === project?.id;

              return (
                <li key={board.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-[5px] px-2 py-2 text-left text-dense font-medium text-white-black transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none",
                      isActive && "bg-active-modal-element",
                    )}
                    onClick={() => switchBoard(board)}
                  >
                    <span className="truncate">
                      {board.title ?? board.name}
                    </span>
                    {isActive && (
                      <Check
                        strokeWidth={1.75}
                        size={14}
                        className="shrink-0"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
};

export default SettingsBoardPicker;
