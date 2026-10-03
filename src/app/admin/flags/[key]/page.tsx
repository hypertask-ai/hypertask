import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  isFeatureFlagOwner,
  listFeatureFlagModes,
} from "@/lib/flags";
import FeatureFlagsAdmin from "../FeatureFlagsAdmin";

export const metadata: Metadata = { title: "Feature flag" };
export const dynamic = "force-dynamic";

export default async function FeatureFlagPage({ params }: { params: Promise<{ key: string }> }) {
  if (!(await isFeatureFlagOwner(await headers()))) notFound();
  const { key } = await params;
  const flags = await listFeatureFlagModes();
  if (!flags.some((flag) => flag.key === key)) notFound();
  return <FeatureFlagsAdmin flagKey={key} />;
}
