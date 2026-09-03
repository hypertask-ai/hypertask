import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { IUser } from "@/models/model";
import AgentChatClient from "./AgentChatClient";

export const metadata: Metadata = {
  title: "Agent Chat",
};

export default async function AgentChatPage() {
  const cookieStore = await cookies();
  const userCookie = cookieStore.get("nookies_user");
  if (!userCookie) return redirect("/login");

  const currentUser: IUser = JSON.parse(userCookie.value);

  return <AgentChatClient currentUser={currentUser} />;
}
