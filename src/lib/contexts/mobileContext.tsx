import { createContext, useContext, useLayoutEffect, useState } from "react";
import { useHydrated } from "@/hooks/General/useHydrated";


export const MobileViewContext = createContext<boolean>(false);
const InitialMobileViewContext = createContext<boolean>(false);

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

  function handleResize() {
    const isMobileViewport = window.innerWidth < 768;
    _setMbl((previous) =>
      previous === isMobileViewport ? previous : isMobileViewport
    );
  }

  useLayoutEffect(() => {
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <InitialMobileViewContext.Provider value={initialIsMobile}>
      <MobileViewContext.Provider value={_mbl}>
        {children}
      </MobileViewContext.Provider>
    </InitialMobileViewContext.Provider>
  );
};

export default MobileViewProvider;
