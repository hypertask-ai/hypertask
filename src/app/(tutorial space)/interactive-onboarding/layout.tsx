"use client";

import FooterContainer from "@/components/PageComponents/Interactive-Onboarding/Components/Footer/Footer";
import SidebarContainer from "@/components/PageComponents/Interactive-Onboarding/Components/Sidebar/Sidebar";
import { TutorialProvider } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import { ReactNode, useContext, useEffect, useState } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { InteractiveTutorialMobileBlocking } from "@/components/Modals/InteractiveTutorialMobileBlocking/InteractiveTutorialMobileBlocking";

export default function TutorialLayout({ children }: { children: ReactNode }) {
  const [showMobileBlocking, setShowMobileBlocking] = useState(false);
  const isMobile = useContext(MobileViewContext);

  useEffect(() => {
    // Show blocking overlay if mobile
    if (isMobile) {
      setShowMobileBlocking(true);
    }
  }, [isMobile]);

  // If mobile, show blocking overlay instead of tutorial
  if (showMobileBlocking) {
    return (
      <InteractiveTutorialMobileBlocking
        onDismiss={() => {
          setShowMobileBlocking(false);
          // Redirect will happen in the component
        }}
      />
    );
  }

  return (
    <>
      <TutorialProvider>
        <FooterContainer>
          <SidebarContainer>
            <main>{children}</main>
          </SidebarContainer>
        </FooterContainer>
      </TutorialProvider>
    </>
  );
}
