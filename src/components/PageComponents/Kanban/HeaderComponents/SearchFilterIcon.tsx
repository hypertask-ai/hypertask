import Tooltip from "@/components/Common/Tooltip";
import { buildSearchUrl } from "@/lib/searchArchive";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import HeaderIconWrapper from "./HeaderIconWrapper";
import type { ReactNode } from "react";

const SearchTasksHeader = ({
  readOnly,
  onClick,
  icon,
  className,
  keyCombination = ["/"],
  tooltipPosition = { left: -10, bottom: -40 },
  fromProject = null,
}: {
  readOnly?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
  className?: string;
  keyCombination?: (string | null)[];
  /** Defaults to the board header's below-left tooltip; the rail places it right. */
  tooltipPosition?: { left: number; bottom: number };
  fromProject?: number | null;
}) => {
  const router = useRouter();
  return (
    <HeaderIconWrapper
      className={className}
      onClick={
        readOnly && onClick
          ? onClick
          : () => router.push(buildSearchUrl("", null, false, fromProject))
      }
    >
      {icon ?? (
        <Search size={16} strokeWidth={1.75} fill="none" className="group-hover:text-header-hover-text" />
      )}
      {readOnly ? null : (
        <Tooltip
          left={tooltipPosition.left}
          bottom={tooltipPosition.bottom}
          text="Search for tasks"
          keyCombination={keyCombination}
        />
      )}
    </HeaderIconWrapper>
  );
};

export default SearchTasksHeader;
