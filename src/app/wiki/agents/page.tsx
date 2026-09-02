import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";

import { markdownToHtml } from "@/utils/helperFunctions/markdownToHtml";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Universal agent onboarding",
  description: "The Hypertask operating guide for every agent provider.",
};

export default async function AgentsWikiPage() {
  const sourcePath = path.join(process.cwd(), "openwiki", "agents.md");
  const markdown = await readFile(sourcePath, "utf8");
  const html = markdownToHtml(markdown);

  return (
    <main className="min-h-screen bg-pageBackground px-5 py-10 text-white-black sm:px-8 sm:py-16">
      <article
        className="mx-auto max-w-4xl text-content leading-7 [&_a]:text-hypertasks-purple [&_a]:underline [&_code]:rounded-[3px] [&_code]:bg-cardBackground [&_code]:px-1 [&_h1]:mb-8 [&_h1]:text-heading [&_h1]:font-semibold [&_h2]:mb-4 [&_h2]:mt-10 [&_h2]:text-subheading [&_h2]:font-semibold [&_h3]:mb-3 [&_h3]:mt-8 [&_h3]:text-emphasis [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-4 [&_ol]:pl-6 [&_p]:my-4 [&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-[5px] [&_pre]:bg-cardBackground [&_pre]:p-4 [&_pre]:leading-6 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_table]:my-5 [&_table]:w-full [&_td]:border [&_td]:border-border-light-gray-thin [&_td]:p-2 [&_th]:border [&_th]:border-border-light-gray-thin [&_th]:p-2 [&_th]:text-left [&_th]:font-semibold [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </main>
  );
}
