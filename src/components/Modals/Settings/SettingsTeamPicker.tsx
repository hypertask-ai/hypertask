"use client";

import { useMemo, useState } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { ITeam } from "@/models/model";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useSettingsTeam } from "./useSettingsTeam";

interface SettingsTeamPickerProps {
  className?: string;
}

const SettingsTeamPicker: React.FC<SettingsTeamPickerProps> = ({
  className,
}) => {
  const { availableTeams, selectTeam, teamId } = useSettingsTeam();
  const [open, setOpen] = useState(false);

  const { data: usageByTeam = {} } = useQuery<Record<string, number>>({
    queryKey: ["settingsTeamUsage"],
    queryFn: async () => {
      const response = await axios.get<{ usage: Record<string, number> }>(
        "/api/settings/team-usage",
      );
      return response.data.usage ?? {};
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const teamList = useMemo(() => {
    return [...availableTeams].sort((a, b) => {
      const usageDelta = (usageByTeam[b.id] ?? 0) - (usageByTeam[a.id] ?? 0);
      if (usageDelta !== 0) return usageDelta;
      return (a.title ?? "").localeCompare(b.title ?? "");
    });
  }, [availableTeams, usageByTeam]);

  const activeTeam =
    teamList.find((team) => team.id === teamId) ?? null;

  if (teamList.length <= 1) return null;

  const switchTeam = (team: ITeam) => {
    setOpen(false);
    if (team.id !== teamId) selectTeam(team.id);
  };

  return (
    <div className={cn("relative w-[180px] shrink-0", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center justify-between gap-2 rounded-[5px] bg-active-modal-element px-2 py-1.5 text-left text-content font-medium text-white-black transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none"
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="truncate">
          {activeTeam?.title ?? teamList[0]?.title ?? "Team"}
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
            {teamList.map((team) => {
              const isActive = team.id === teamId;

              return (
                <li key={team.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-[5px] px-2 py-2 text-left text-dense font-medium text-white-black transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none",
                      isActive && "bg-active-modal-element",
                    )}
                    onClick={() => switchTeam(team)}
                  >
                    <span className="truncate">{team.title}</span>
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

export default SettingsTeamPicker;
