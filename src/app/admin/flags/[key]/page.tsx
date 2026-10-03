import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  FEATURE_FLAG_OWNER_USER_ID,
  FEATURE_FLAG_PAGES_FLAG,
  isFeatureEnabled,
  isFeatureFlagOwner,
  listFeatureFlagModes,
} from "@/lib/flags";
import FeatureFlagsAdmin from "../FeatureFlagsAdmin";

export const metadata: Metadata = { title: "Feature flag" };
export const dynamic = "force-dynamic";

export default async function FeatureFlagPage({ params }: { params: Promise<{ key: string }> }) {
  if (!(await isFeatureFlagOwner(await headers()))) notFound();
  if (!(await isFeatureEnabled(FEATURE_FLAG_PAGES_FLAG, FEATURE_FLAG_OWNER_USER_ID))) notFound();
  const { key } = await params;
  const flags = await listFeatureFlagModes();
  if (!flags.some((flag) => flag.key === key)) notFound();
  return <FeatureFlagsAdmin flagKey={key} pagesEnabled />;
}
