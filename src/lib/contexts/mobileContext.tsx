import { createContext, useLayoutEffect, useState } from "react";


/** True when the browser viewport is narrow (<768px). Used for device-level UX (sheets, touch, full-page mobile layouts). Main-column reflow beside the AI sidebar uses CSS container queries, not this flag. */
export const MobileViewContext = createContext<boolean>(false);

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
    <MobileViewContext.Provider value={_mbl}>
      {children}
    </MobileViewContext.Provider>
  );
};

export default MobileViewProvider;
