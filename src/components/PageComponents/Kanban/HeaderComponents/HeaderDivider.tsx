import React, { useContext } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";

const HeaderDivider: React.FC = () => {
  const isMbl = useContext(MobileViewContext);

  return (
    <div
      className={`board-header-divider w-[22px] rotate-90 border-[#5E5F60] ${
        isMbl ? "mx-[-4px] border-[0.25px]" : "mx-2 border-[0.75px]"
      }`}
    />
  );
};

export default HeaderDivider;
