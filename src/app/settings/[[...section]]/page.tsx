import SettingsShell from "@/components/Modals/Settings/SettingsShell";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function Page(props: {
  params: Promise<{ section?: string[] }>;
}) {
  const params = await props.params;
  return <SettingsShell section={params.section?.[0]} />;
}
