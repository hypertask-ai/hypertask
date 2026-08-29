import { IProject } from "@/models/model";
import { Metadata } from "next";
import { redirect } from "next/navigation";
import getProject from "@/utils/controllers/share/getProject";
import ReadOnlyKanban from "@/components/PageComponents/Shared/Project/kanban";

export const metadata: Metadata = {
  title: "Hypertask",
  robots: "noindex, nofollow",
  // See share/page.tsx: keeps Chrome Translate from rewriting the DOM before
  // hydration (React #418 on public share links, HTPR-4980).
  other: { google: "notranslate" },
};

export default async function Page(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  let slugs = searchParams?.id;
  if (!slugs || slugs === "undefined" || slugs === "null" || slugs === "") {
    console.log(
      "❌ Invalid or missing share ID in URL, resolving valid slug..."
    );
     redirect("/unauthorized");
  }
  const response = await getProject(slugs);
  if (response.status !== 200) {
     redirect("/unauthorized");
  }
  // display:contents keeps the wrapper layout-neutral; translate="no" is the
  // Chrome-Translate #418 guard (HTPR-4980).
  return (
    <div className="contents" translate="no">
      <ReadOnlyKanban project={response.json as unknown as IProject} inviteKey={slugs} />
    </div>
  );
}
