import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { loadCurrentUser } from "@/lib/auth/currentUser";
import { requireDevicePairingEnabled } from "@/lib/auth/devicePairing";

export const metadata = { title: "Sign in an agent", robots: "noindex, nofollow" };
export const dynamic = "force-dynamic";

export default async function AgentSignInPage() {
  const user = await loadCurrentUser(await headers());
  if (!user) redirect("/login?returnTo=%2Flogin%2Fagent");
  if (user.agentId || user.source === "cli-bearer") notFound();
  try { await requireDevicePairingEnabled(user.userId); } catch { notFound(); }
  redirect("/cli-auth?agent=1");
}
