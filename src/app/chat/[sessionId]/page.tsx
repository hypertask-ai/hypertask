import { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ChatClient from "../ChatClient";

export const metadata: Metadata = {
  title: "AI Chat",
};

export default async function ChatPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const cookieStore = await cookies();

  if (!cookieStore.get("nookies_user")) {
    redirect("/login");
  }

  const { sessionId } = await params;

  return <ChatClient initialSessionId={sessionId} />;
}
