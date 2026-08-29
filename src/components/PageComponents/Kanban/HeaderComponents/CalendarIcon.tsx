import Tooltip from "@/components/Common/Tooltip";
import React from "react";
import HeaderIconWrapper from "./HeaderIconWrapper";
import { CalendarDays } from "lucide-react";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";

const CalendarIcon = () => {
  const { navigate } = useHypertasksNavigate();

  return (
    <HeaderIconWrapper onClick={() => navigate("Calendar")}>
      <CalendarDays size={16} strokeWidth={1.75} fill="none" className="group-hover:text-header-hover-text" />
      <Tooltip
        left={-10}
        bottom={-40}
        text="Go to calendar"
        keyCombination={["G", null, "C"]}
      />
    </HeaderIconWrapper>
  );
};

export default CalendarIcon;
