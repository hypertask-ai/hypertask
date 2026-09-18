import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { IUser } from "@/models/model";
import AgentChatClient from "./AgentChatClient";
import AgentRoomClient from "./AgentRoomClient";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This server component must expose its gate directly to CI.
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6557_AGENT_ROOMS_FLAG } from "@/lib/flags/keys";

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
  const roomsEnabled = await isFeatureEnabled(
    HTPR_6557_AGENT_ROOMS_FLAG,
    currentUser.id,
  );
  if (roomsEnabled && (await searchParams).view === "rooms") {
    return <AgentRoomClient />;
  }

  return (
    <AgentChatClient currentUser={currentUser} roomsEnabled={roomsEnabled} />
  );
}
