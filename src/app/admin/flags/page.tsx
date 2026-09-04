import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isFeatureFlagOwner } from "@/lib/flags";
import FeatureFlagsAdmin from "./FeatureFlagsAdmin";

export const metadata: Metadata = { title: "Feature flags" };
export const dynamic = "force-dynamic";

export default async function FeatureFlagsPage() {
  if (!(await isFeatureFlagOwner(await headers()))) notFound();
  return <FeatureFlagsAdmin />;
}
