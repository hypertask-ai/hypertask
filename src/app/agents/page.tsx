import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { IUser } from "@/models/model";
import AgentsRegister from "./AgentsRegister";

export const metadata: Metadata = {
  title: "Agents",
};

export default async function AgentsPage() {
  const cookieStore = await cookies();
  const userCookie = cookieStore.get("nookies_user");
  if (!userCookie) return redirect("/login");

  const currentUser: IUser = JSON.parse(userCookie.value);

  return <AgentsRegister currentUser={currentUser} />;
}
