import { IUser } from "@/models/model";
import { cookies } from "next/headers";
import { Metadata } from "next";
import { redirect } from "next/navigation";
import Drafts from "./Drafts";

export const metadata: Metadata = {
  title: "Drafts",
};

export default async function DraftsPage() {
  const cookieStore = await cookies();
  const userObjString = cookieStore.get("nookies_user");

  if (!userObjString) return redirect("/login");

  const userObj: IUser = JSON.parse(userObjString.value);

  return <Drafts currentUser={userObj} />;
}
