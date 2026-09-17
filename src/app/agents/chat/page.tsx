import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { IUser } from "@/models/model";
import AgentChatClient from "./AgentChatClient";
import AgentRoomClient from "./AgentRoomClient";
import { agentRoomsEnabled } from "@/lib/agents/roomAccess";

export const metadata: Metadata = {
  title: "Agent Chat",
};

export default async function AgentChatPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const cookieStore = await cookies();
  const userCookie = cookieStore.get("nookies_user");
  if (!userCookie) return redirect("/login");

  const currentUser: IUser = JSON.parse(userCookie.value);
  const roomsEnabled = await agentRoomsEnabled(currentUser.id);
  if (roomsEnabled && (await searchParams).view === "rooms") {
    return <AgentRoomClient />;
  }

  return (
    <AgentChatClient currentUser={currentUser} roomsEnabled={roomsEnabled} />
  );
}
