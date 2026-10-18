import { useContext, useEffect } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7308_PHONE_LAYOUT_WIDTH_FLAG } from "@/lib/flags/definitions/htpr-7308-phone-layout-width";
import { SetMeasureLayoutWidthContext } from "./mobileContext";

export default function MobileViewFlagBridge() {
  const measureLayoutWidth = useFlag(HTPR_7308_PHONE_LAYOUT_WIDTH_FLAG);
  const setMeasureLayoutWidth = useContext(SetMeasureLayoutWidthContext);
  useEffect(() => {
    setMeasureLayoutWidth(measureLayoutWidth);
  }, [measureLayoutWidth, setMeasureLayoutWidth]);
  return null;
}
