"use client";

import dynamic from "next/dynamic";
import FullScreenChatLoading from "@/components/AI_CHAT/FullScreenChatLoading";

// The chat tree is client-only everywhere (AI_Chat_Layout mounts with
// ssr: false); rendering it on the server 500s. Load it the same way here.
const Chat = dynamic(() => import("./Chat"), {
  ssr: false,
  loading: () => <FullScreenChatLoading />,
});

type ChatClientProps = {
  initialSessionId?: string;
};

export default function ChatClient({ initialSessionId }: ChatClientProps) {
  return <Chat initialSessionId={initialSessionId} />;
}
