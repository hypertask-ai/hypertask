import { IProject } from "@/models/model";
import { Metadata } from "next";
import { redirect } from "next/navigation";
import getProject from "@/utils/controllers/share/getProject";
import ReadOnlyKanban from "@/components/PageComponents/Shared/Project/kanban";

export const metadata: Metadata = {
  title: "Hypertask",
  robots: "noindex, nofollow",
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
  return (
    <div className="contents" translate="no">
      <ReadOnlyKanban project={response.json as unknown as IProject} inviteKey={slugs} />
    </div>
  );
}
