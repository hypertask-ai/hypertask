import { createContext, useContext, useLayoutEffect, useState } from "react";
import { useHydrated } from "@/hooks/General/useHydrated";


export const MobileViewContext = createContext<boolean>(false);
const InitialMobileViewContext = createContext<boolean>(false);
export const SetMeasureLayoutWidthContext = createContext<(enabled: boolean) => void>(() => {});

const DESKTOP_LAYOUT_QUERY = "(min-width: 768px)";

export const isPhoneViewport = (measureLayoutWidth: boolean) =>
  measureLayoutWidth
    ? !window.matchMedia(DESKTOP_LAYOUT_QUERY).matches
    : window.innerWidth < 768;

export const useMobileView = () => {
  const mobile = useContext(MobileViewContext);
  const initialMobile = useContext(InitialMobileViewContext);
  return useHydrated() ? mobile : initialMobile;
};

const MobileViewProvider: React.FC<{
  children: React.ReactNode;
  initialIsMobile: boolean;
}> = ({ children, initialIsMobile }) => {
  const [_mbl, _setMbl] = useState(initialIsMobile);
  const [measureLayoutWidth, setMeasureLayoutWidth] = useState(true);

  useLayoutEffect(() => {
    function handleResize() {
      const isMobileViewport = isPhoneViewport(measureLayoutWidth);
      _setMbl((previous) =>
        previous === isMobileViewport ? previous : isMobileViewport
      );
    }
    handleResize();
    const desktopLayout = window.matchMedia(DESKTOP_LAYOUT_QUERY);
    window.addEventListener("resize", handleResize);
    desktopLayout.addEventListener?.("change", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      desktopLayout.removeEventListener?.("change", handleResize);
    };
  }, [measureLayoutWidth]);

  return (
    <SetMeasureLayoutWidthContext.Provider value={setMeasureLayoutWidth}>
      <InitialMobileViewContext.Provider value={initialIsMobile}>
        <MobileViewContext.Provider value={_mbl}>
          {children}
        </MobileViewContext.Provider>
      </InitialMobileViewContext.Provider>
    </SetMeasureLayoutWidthContext.Provider>
  );
};

export default MobileViewProvider;
