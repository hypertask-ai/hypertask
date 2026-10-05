"use client";

import type { IUser } from "@/models/model";
import MobileTopBar from "./MobileTopBar";
import MobileHeaderStrip from "./MobileHeaderStrip";
import MobileTopBarActions from "./MobileTopBarActions";
import MobileTabBar from "./MobileTabBar";

export default function FirstScreenMobileChromeContent({ currentUser, showDock }: {
  currentUser: IUser;
  showDock: boolean;
}) {
  // Critical controls must already be available when the seeded header hydrates.
  return <>
    <MobileTopBar currentUser={currentUser} boardUsable headerStrip={MobileHeaderStrip} topBarActions={MobileTopBarActions} />
    {showDock && <MobileTabBar currentUserId={currentUser.id} />}
  </>;
}
