"use client";

import dynamic from "next/dynamic";
import type { IUser } from "@/models/model";
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";
import { useRecoilValue } from "@/lib/state";
import { agentChatMobileFullscreenAtom, mobileCommentComposerOpenAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG } from "@/lib/flags/keys";

const ChromeContent = dynamic(() => import("./FirstScreenMobileChromeContent"));

export default function FirstScreenMobileChrome({ currentUser }: { currentUser: IUser }) {
  const snapshot = useFirstScreenSurface(currentUser.id);
  const fullscreen = useRecoilValue(agentChatMobileFullscreenAtom);
  const fullscreenEnabled = useFlag(HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG);
  const composerOpen = useRecoilValue(mobileCommentComposerOpenAtom);
  if (!snapshot || (fullscreenEnabled && fullscreen)) return null;
  return <ChromeContent currentUser={currentUser} showDock={snapshot.scope.route === "/project" && !composerOpen} />;
}
