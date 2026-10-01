import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  FEATURE_FLAG_OWNER_USER_ID,
  HTPR_6653_ADMIN_TEAM_COMP_FLAG,
  isFeatureEnabled,
  isFeatureFlagOwner,
} from "@/lib/flags";
import TeamCompAdmin from "./TeamCompAdmin";

export const metadata: Metadata = { title: "Team comps" };
export const dynamic = "force-dynamic";

export default async function TeamCompPage() {
  if (!(await isFeatureFlagOwner(await headers()))) notFound();
  if (!(await isFeatureEnabled(HTPR_6653_ADMIN_TEAM_COMP_FLAG, FEATURE_FLAG_OWNER_USER_ID))) notFound();
  return <TeamCompAdmin />;
}
