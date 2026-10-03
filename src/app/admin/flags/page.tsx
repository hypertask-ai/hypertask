import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  FEATURE_FLAG_OWNER_USER_ID,
  FEATURE_FLAG_PAGES_FLAG,
  isFeatureEnabled,
  isFeatureFlagOwner,
} from "@/lib/flags";
import FeatureFlagsAdmin from "./FeatureFlagsAdmin";

export const metadata: Metadata = { title: "Feature flags" };
export const dynamic = "force-dynamic";

export default async function FeatureFlagsPage() {
  if (!(await isFeatureFlagOwner(await headers()))) notFound();
  const pagesEnabled = await isFeatureEnabled(FEATURE_FLAG_PAGES_FLAG, FEATURE_FLAG_OWNER_USER_ID);
  return <FeatureFlagsAdmin pagesEnabled={pagesEnabled} />;
}
