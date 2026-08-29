import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { IUser } from "@/models/model";
import AgentDetail from "./AgentDetail";

export const metadata: Metadata = {
  title: "Agent",
};

export default async function AgentPage(props: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await props.params;
  const cookieStore = await cookies();
  const userCookie = cookieStore.get("nookies_user");
  if (!userCookie) return redirect("/login");

  const currentUser: IUser = JSON.parse(userCookie.value);

  return <AgentDetail agentId={agentId} currentUser={currentUser} />;
}
