"use client";

import dynamic from "next/dynamic";
import type { IUser } from "@/models/model";
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";
import { useRecoilValue } from "@/lib/state";
import { agentChatMobileFullscreenAtom, mobileCommentComposerOpenAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG } from "@/lib/flags/keys";

const MobileTopBar = dynamic(async () => {
  const { default: TopBar, loadFirstScreenControls } = await import("./MobileTopBar");
  // Resolve the existing chunks before any header hydration subscription updates.
  const { HeaderStrip, TopBarActions } = await loadFirstScreenControls();
  return function SeededTopBar({ currentUser }: { currentUser: IUser }) {
    return <TopBar currentUser={currentUser} boardUsable headerStrip={HeaderStrip} topBarActions={TopBarActions} />;
  };
});
const MobileTabBar = dynamic(() => import("./MobileTabBar"));

export default function FirstScreenMobileChrome({ currentUser }: { currentUser: IUser }) {
  const snapshot = useFirstScreenSurface(currentUser.id);
  const fullscreen = useRecoilValue(agentChatMobileFullscreenAtom);
  const fullscreenEnabled = useFlag(HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG);
  const composerOpen = useRecoilValue(mobileCommentComposerOpenAtom);
  if (!snapshot || (fullscreenEnabled && fullscreen)) return null;
  return <>
    <MobileTopBar currentUser={currentUser} />
    {snapshot.scope.route === "/project" && !composerOpen && <MobileTabBar currentUserId={currentUser.id} />}
  </>;
}
