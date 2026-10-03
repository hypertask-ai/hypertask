import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  isFeatureFlagOwner,
} from "@/lib/flags";
import TeamCompAdmin from "./TeamCompAdmin";

export const metadata: Metadata = { title: "Team comps" };
export const dynamic = "force-dynamic";

export default async function TeamCompPage() {
  if (!(await isFeatureFlagOwner(await headers()))) notFound();
  return <TeamCompAdmin />;
}
