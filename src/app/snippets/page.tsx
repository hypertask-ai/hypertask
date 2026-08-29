import { cookies } from "next/headers";
import { Metadata } from "next";
import { redirect } from "next/navigation";
import Snippets from "./Snippets";

export const metadata: Metadata = {
  title: "Snippets",
};

export default async function SnippetsPage() {
  const cookieStore = await cookies();
  const userObjString = cookieStore.get("nookies_user");

  if (!userObjString) return redirect("/login");

  return <Snippets />;
}
