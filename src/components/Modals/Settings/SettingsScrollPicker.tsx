"use client";

import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { ScrollSetting } from "@prisma/client";
import { useGetScrollSetting } from "@/hooks/General/useGetScrollSetting";
import globalConstants from "@/lib/constants";
import { cn } from "@/utils/undoActions/helperFuncs";

const scrollOptions: { text: string; type: ScrollSetting }[] = [
  { text: "No scroll", type: "None" },
  { text: "Scroll to bottom", type: "Bottom" },
  { text: "Scroll to bottom when coming from inbox", type: "Inbox" },
];

// Inline version of the Scroll Settings modal — the three options rendered
// directly in Settings so picking one is a single click. The modal component
// still exists; this just removes the extra step here.
const SettingsScrollPicker = () => {
  const queryClient = useQueryClient();
  const { data } = useGetScrollSetting([globalConstants.ScrollSettingKey]);
  const current: ScrollSetting = data?.setting ?? "None";

  const change = async (type: ScrollSetting) => {
    if (type === current) return;
    const previous = data;
    queryClient.setQueryData([globalConstants.ScrollSettingKey], {
      setting: type,
    });
    try {
      await axios.post("/api/users/scrollSettings/changeScrollSetting", {
        setting: type,
      });
    } catch (error) {
      console.error("Could not update scroll setting:", error);
      queryClient.setQueryData([globalConstants.ScrollSettingKey], previous);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <p className="px-2 pb-1 text-meta font-semibold uppercase tracking-wide text-text-light-gray">
        Task scroll
      </p>
      {scrollOptions.map((option) => {
        const isActive = current === option.type;
        return (
          <button
            key={option.type}
            type="button"
            className={cn(
              "flex items-center justify-between gap-4 rounded-[5px] px-2 py-2 text-left text-dense font-medium text-white-black outline-none transition hover:bg-hover-active focus-visible:bg-hover-active",
              isActive && "bg-active-modal-element"
            )}
            onClick={() => change(option.type)}
          >
            <span>{option.text}</span>
            {isActive && <Check strokeWidth={1.75} size={14} className="shrink-0" />}
          </button>
        );
      })}
    </div>
  );
};

export default SettingsScrollPicker;
