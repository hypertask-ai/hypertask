import { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Settings",
};

const BOARD_SECTIONS = new Set([
  "board-general",
  "board-ai",
  "board-skills",
  "board-files",
  "board-members",
  "board-agents",
]);

export default async function Page(props: {
  params: Promise<{ section?: string[] }>;
}) {
  const params = await props.params;
  const requestedSection = params.section?.[0];
  const section =
    requestedSection && BOARD_SECTIONS.has(requestedSection)
      ? requestedSection
      : "board-general";

  redirect(`/settings/${section}`);
}
