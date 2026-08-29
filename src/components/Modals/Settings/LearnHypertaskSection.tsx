"use client";

import Link from "next/link";
import { ToggleQuickTips } from "@/components/sidebars/RightSidebar/Single section items";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";

const externalResources = [
  {
    description: "Watch short walkthroughs of core Hypertask workflows.",
    href: "https://www.youtube.com/playlist?list=PLb7ZrOwcC7l2Du0sq2-fj4uJG7N0vjxmQ",
    title: "Tutorial Videos",
  },
  {
    description: "Connect AI assistants to your workspace with MCP.",
    href: "https://help.hypertask.ai/help/how-to-connect-ai-agents-to-hypertask-with-mcp",
    title: "MCP Guide",
  },
  {
    description: "Book a one-to-one session for hands-on product help.",
    href: "https://calendar.superhuman.com/book/11SzDGi12vkuEu8gf0/icPzJ",
    title: "Book Coaching",
  },
  {
    description: "Find answers to common setup and workflow questions.",
    href: "https://help.hypertask.ai/",
    title: "Help Center",
  },
  {
    description: "Browse technical guides for Hypertask integrations and APIs.",
    href: "https://docs.hypertask.ai/",
    title: "Docs",
  },
  {
    description: "Add board-specific properties like ICE score, channel, or launch date.",
    href: "https://docs.hypertask.ai/features/custom-fields/",
    title: "Custom fields",
  },
];

const LearnHypertaskSection = () => {
  return (
    <SettingsSectionShell title="Learn Hypertask">
      <SettingsCard title="Guides">
        {externalResources.map((resource) => (
          <ResourceRow key={resource.title} {...resource} external />
        ))}
      </SettingsCard>

      <SettingsCard title="Tips">
        <ToggleQuickTips ToggleComponent={SettingsToggle} />
      </SettingsCard>
    </SettingsSectionShell>
  );
};

const ResourceRow = ({
  description,
  external = false,
  href,
  title,
}: {
  description: string;
  external?: boolean;
  href: string;
  title: string;
}) => {
  return (
    <Link
      className="flex flex-col gap-1 rounded-[5px] px-2 py-2 hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none"
      href={href}
      rel={external ? "noopener noreferrer" : undefined}
      target={external ? "_blank" : undefined}
    >
      <span className="text-dense font-semibold text-white-black">
        {title}
      </span>
      <span className="text-dense font-medium text-text-light-gray">
        {description}
      </span>
    </Link>
  );
};

export default LearnHypertaskSection;
