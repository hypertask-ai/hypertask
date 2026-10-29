"use client";

import dynamic from "next/dynamic";
import type { IUser } from "@/models/model";
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";
import { useRecoilValue } from "@/lib/state";
import { agentChatMobileFullscreenAtom, mobileCommentComposerOpenAtom } from "@/store";

const MobileTopBar = dynamic(async () => {
  const { default: TopBar, loadFirstScreenControls } = await import("./MobileTopBar");
  const { HeaderStrip, TopBarActions } = await loadFirstScreenControls();
  return function SeededTopBar({ currentUser }: { currentUser: IUser; boardUsable?: boolean }) {
    return <TopBar currentUser={currentUser} boardUsable headerStrip={HeaderStrip} topBarActions={TopBarActions} />;
  };
});
const MobileTabBar = dynamic(() => import("./MobileTabBar"));

export default function FirstScreenMobileChrome({ currentUser }: { currentUser: IUser }) {
  const snapshot = useFirstScreenSurface(currentUser.id);
  const fullscreen = useRecoilValue(agentChatMobileFullscreenAtom);
  const composerOpen = useRecoilValue(mobileCommentComposerOpenAtom);
  if (!snapshot || fullscreen) return null;
  return <>
    <MobileTopBar currentUser={currentUser} boardUsable />
    {snapshot.scope.route === "/project" && !composerOpen && <MobileTabBar currentUserId={currentUser.id} />}
  </>;
}
