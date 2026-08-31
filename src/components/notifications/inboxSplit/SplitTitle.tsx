"use client";

import type { ReactNode } from "react";
import { useInboxZeroStyling } from "@/hooks/Inbox/useInboxZeroStyling";
import type { InboxTabMeta } from "@/utils/helperFunctions/helperFunctions";
import { Circle } from "lucide-react";

type SplitTitleTab = Pick<
  InboxTabMeta,
  "idx" | "project" | "length" | "hasUnseen"
> & {
  projectId?: number | null;
};

const SplitTitle = ({
  tab,
  isSelected,
  onClick,
  showUnseenIndicator = true,
  trailingAction,
}: {
  tab: SplitTitleTab;
  isSelected: boolean;
  onClick: () => void;
  showUnseenIndicator?: boolean;
  trailingAction?: ReactNode;
}) => {
  const { classes } = useInboxZeroStyling();

  return (
    <div
      key={tab.project?.toString()}
      className={` cursor-pointer relative group @md:h-8
                        justify-start
                        whitespace-nowrap footer_tags_main items-center
                        @md:pr-[10px] @lg:pr-[15px]
                        text-content flex gap-1 `}
      onClick={onClick}
    >
      <div
        className={`flex items-baseline gap-1 ${
          isSelected ? "text-text-light-gray" : classes.textPrimary
        }`}
      >
        <span className="footer_tags">{tab.project}</span>

        {tab.length > 0 && (
          <p
            className={`font-normal footer_tags text-micro ${classes.textSecondary}`}
          >
            {tab.length}
          </p>
        )}
      </div>

      <Circle
        size={7}
        className={`fill-current ${
          showUnseenIndicator && !tab.hasUnseen ? "text-[#5896F1]" : "hidden"
        }  w-new-notification`}
        strokeWidth={1.75}
        fill="currentColor"
      />
      {trailingAction}
    </div>
  );
};

export default SplitTitle;
