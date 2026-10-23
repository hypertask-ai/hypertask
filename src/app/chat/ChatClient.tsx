"use client";

import dynamic from "next/dynamic";
import FullScreenChatLoading from "@/components/AI_CHAT/FullScreenChatLoading";

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
